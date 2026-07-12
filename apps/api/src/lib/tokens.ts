import crypto from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import type { Db } from '../db/client.js';
import { adminRefreshTokens } from '../db/schema.js';
import { env } from '../env.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // house rule: access tokens ≤ 15 min
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, rotated on every use

interface AdminClaims {
  role: 'admin';
}

export function issueAccessToken(): string {
  const claims: AdminClaims = { role: 'admin' };
  return jwt.sign(claims, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    issuer: 'zenfinance-api',
    audience: 'zenfinance-admin',
  });
}

export function verifyAccessToken(token: string): AdminClaims {
  // Explicit algorithms allowlist — never let the token pick its own.
  const payload = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'zenfinance-api',
    audience: 'zenfinance-admin',
  });
  if (typeof payload !== 'object' || payload === null || (payload as AdminClaims).role !== 'admin') {
    throw new Error('invalid admin claims');
  }
  return payload as unknown as AdminClaims;
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function newOpaqueToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export async function issueRefreshToken(db: Db, familyId?: string): Promise<string> {
  const raw = newOpaqueToken();
  await db.insert(adminRefreshTokens).values({
    familyId: familyId ?? crypto.randomUUID(),
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return raw;
}

/**
 * Rotate a refresh token: the presented token is retired and a new one is
 * issued in the same family. Presenting a token that was already rotated is
 * treated as theft and revokes the entire family.
 */
export async function rotateRefreshToken(db: Db, presented: string): Promise<RefreshResult | null> {
  const presentedHash = hashToken(presented);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(adminRefreshTokens)
      .where(eq(adminRefreshTokens.tokenHash, presentedHash))
      .limit(1);

    if (!row) return null;

    const now = new Date();
    if (row.revokedAt || row.replacedById !== null) {
      // Reuse of a rotated/revoked token → revoke the whole session family.
      await tx
        .update(adminRefreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(adminRefreshTokens.familyId, row.familyId), isNull(adminRefreshTokens.revokedAt)));
      return null;
    }
    if (row.expiresAt < now) return null;

    const [claimed] = await tx
      .update(adminRefreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(adminRefreshTokens.id, row.id), isNull(adminRefreshTokens.revokedAt), isNull(adminRefreshTokens.replacedById)))
      .returning({ id: adminRefreshTokens.id });
    if (!claimed) {
      await tx
        .update(adminRefreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(adminRefreshTokens.familyId, row.familyId), isNull(adminRefreshTokens.revokedAt)));
      return null;
    }

    const rawNext = newOpaqueToken();
    const [next] = await tx
      .insert(adminRefreshTokens)
      .values({
        familyId: row.familyId,
        tokenHash: hashToken(rawNext),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      })
      .returning({ id: adminRefreshTokens.id });

    await tx
      .update(adminRefreshTokens)
      .set({ replacedById: next!.id })
      .where(eq(adminRefreshTokens.id, row.id));

    return { accessToken: issueAccessToken(), refreshToken: rawNext };
  });
}

export async function revokeRefreshToken(db: Db, presented: string): Promise<void> {
  const presentedHash = hashToken(presented);
  const [row] = await db
    .select({ familyId: adminRefreshTokens.familyId })
    .from(adminRefreshTokens)
    .where(eq(adminRefreshTokens.tokenHash, presentedHash))
    .limit(1);
  if (!row) return;
  await db
    .update(adminRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(adminRefreshTokens.familyId, row.familyId), isNull(adminRefreshTokens.revokedAt)));
}

/** Timing-safe comparison for the admin shared secret. */
export function verifyAdminSecret(candidate: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(env.ADMIN_SECRET);
  if (a.length !== b.length) {
    // Compare against self to keep timing uniform, then reject.
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}
