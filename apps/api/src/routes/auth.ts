import {
  appleAuthSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  type AppleAuthInput,
  type ForgotPasswordInput,
  type LoginInput,
  type RefreshInput,
  type RegisterInput,
  type ResetPasswordInput,
} from '@zenfinance/shared';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db/client.js';
import { passwordResetCodes, users } from '../db/schema.js';
import { env } from '../env.js';
import { verifyAppleIdentityToken } from '../lib/apple.js';
import { sendPasswordResetEmail } from '../lib/email.js';
import {
  issueUserAccessToken,
  issueUserRefreshToken,
  revokeAllUserRefreshTokens,
  revokeUserRefreshToken,
  rotateUserRefreshToken,
} from '../lib/userTokens.js';
import { validateBody } from '../middleware/validate.js';

const RESET_CODE_TTL_MS = 15 * 60 * 1000;

function hashResetCode(code: string): string {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(code).digest('hex');
}

const BCRYPT_ROUNDS = 12;

export function createAuthRouter(): ReturnType<typeof Router> {
  const authRouter = Router();

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many attempts, try again later' } },
  });

  async function issueTokens(userId: number) {
    return {
      accessToken: issueUserAccessToken(userId),
      refreshToken: await issueUserRefreshToken(db, userId),
    };
  }

  authRouter.post(
    '/api/auth/register',
    authLimiter,
    validateBody(registerSchema),
    async (_req, res) => {
      const input = res.locals.body as RegisterInput;
      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
      const [user] = await db
        .insert(users)
        .values({ email: input.email, passwordHash })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });
      if (!user) {
        // Same status as validation failure — no account enumeration.
        res.status(400).json({
          error: { code: 'invalid_request', message: 'Unable to register with this email' },
        });
        return;
      }
      res.status(201).json(await issueTokens(user.id));
    },
  );

  authRouter.post('/api/auth/login', authLimiter, validateBody(loginSchema), async (_req, res) => {
    const input = res.locals.body as LoginInput;
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    // Always burn a bcrypt comparison so timing doesn't reveal account existence.
    const hash = user?.passwordHash ?? (await bcrypt.hash('timing-equalizer', 4));
    const ok = await bcrypt.compare(input.password, hash);
    if (!user?.passwordHash || !ok) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid credentials' } });
      return;
    }
    res.json(await issueTokens(user.id));
  });

  authRouter.post(
    '/api/auth/apple',
    authLimiter,
    validateBody(appleAuthSchema),
    async (_req, res) => {
      const input = res.locals.body as AppleAuthInput;
      let identity;
      try {
        identity = await verifyAppleIdentityToken(input.identityToken, input.rawNonce);
      } catch {
        res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid identity token' } });
        return;
      }

      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.appleSub, identity.sub))
        .limit(1);
      if (existing) {
        res.json(await issueTokens(existing.id));
        return;
      }

      // Apple only shares the email on first sign-in. Never trust a client-supplied
      // email to attach an Apple subject to an existing account.
      const email = identity.email;
      if (!email || identity.emailVerified === false) {
        res.status(400).json({
          error: { code: 'invalid_request', message: 'Verified Apple email required on first sign-in' },
        });
        return;
      }

      // Link to an existing email account or create a fresh one.
      const [byEmail] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (byEmail) {
        await db
          .update(users)
          .set({ appleSub: identity.sub, updatedAt: new Date() })
          .where(eq(users.id, byEmail.id));
        res.json(await issueTokens(byEmail.id));
        return;
      }
      const [created] = await db
        .insert(users)
        .values({ email, appleSub: identity.sub })
        .returning({ id: users.id });
      res.status(201).json(await issueTokens(created!.id));
    },
  );

  // Request a reset code. Always 200 with the same body so the response can't
  // be used to probe which emails have accounts.
  authRouter.post(
    '/api/auth/forgot',
    authLimiter,
    validateBody(forgotPasswordSchema),
    async (_req, res) => {
      const input = res.locals.body as ForgotPasswordInput;
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (user) {
        // Invalidate any outstanding codes, then issue a fresh one.
        await db
          .update(passwordResetCodes)
          .set({ consumedAt: new Date() })
          .where(and(eq(passwordResetCodes.userId, user.id), isNull(passwordResetCodes.consumedAt)));
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        await db.insert(passwordResetCodes).values({
          userId: user.id,
          codeHash: hashResetCode(code),
          expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
        });
        const delivered = await sendPasswordResetEmail(input.email, code);
        if (!delivered) {
          // Preserve the non-enumerating response while ensuring an
          // undelivered code cannot remain valid in the database.
          await db
            .update(passwordResetCodes)
            .set({ consumedAt: new Date() })
            .where(and(eq(passwordResetCodes.userId, user.id), isNull(passwordResetCodes.consumedAt)));
          console.error(`[auth] password reset delivery failed for user ${user.id}`);
        }
      }
      res.json({ ok: true });
    },
  );

  // Complete a reset with the emailed code. On success every existing session
  // is revoked so a stolen refresh token can't outlive the password change.
  authRouter.post(
    '/api/auth/reset',
    authLimiter,
    validateBody(resetPasswordSchema),
    async (_req, res) => {
      const input = res.locals.body as ResetPasswordInput;
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      const invalid = () =>
        res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid or expired code' } });
      if (!user) {
        invalid();
        return;
      }
      const [codeRow] = await db
        .select()
        .from(passwordResetCodes)
        .where(
          and(
            eq(passwordResetCodes.userId, user.id),
            eq(passwordResetCodes.codeHash, hashResetCode(input.code)),
            isNull(passwordResetCodes.consumedAt),
            gt(passwordResetCodes.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!codeRow) {
        invalid();
        return;
      }
      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
      await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
      await db.update(passwordResetCodes).set({ consumedAt: new Date() }).where(eq(passwordResetCodes.id, codeRow.id));
      await revokeAllUserRefreshTokens(db, user.id);
      res.json({ ok: true });
    },
  );

  authRouter.post('/api/auth/refresh', validateBody(refreshSchema), async (_req, res) => {
    const input = res.locals.body as RefreshInput;
    const rotated = await rotateUserRefreshToken(db, input.refreshToken);
    if (!rotated) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid refresh token' } });
      return;
    }
    res.json({ accessToken: rotated.accessToken, refreshToken: rotated.refreshToken });
  });

  authRouter.post('/api/auth/logout', validateBody(refreshSchema), async (_req, res) => {
    const input = res.locals.body as RefreshInput;
    await revokeUserRefreshToken(db, input.refreshToken);
    res.json({ ok: true });
  });

  return authRouter;
}
