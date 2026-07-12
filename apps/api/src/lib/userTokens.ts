import crypto from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import type { Db } from '../db/client.js';
import { userRefreshTokens } from '../db/schema.js';
import { env } from '../env.js';

export const USER_ACCESS_TTL_SECONDS = 15 * 60;
export const USER_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, rotated on every use

export function issueUserAccessToken(userId: number): string {
  return jwt.sign({ sub: String(userId) }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: USER_ACCESS_TTL_SECONDS,
    issuer: 'zenfinance-api',
    audience: 'zenfinance-user',
  });
}

export function verifyUserAccessToken(token: string): number {
  const payload = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'zenfinance-api',
    audience: 'zenfinance-user',
  });
  const sub = typeof payload === 'object' && payload !== null ? payload.sub : undefined;
  const userId = Number(sub);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('invalid user claims');
  return userId;
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function issueUserRefreshToken(
  db: Db,
  userId: number,
  familyId?: string,
): Promise<string> {
  const raw = crypto.randomBytes(48).toString('base64url');
  await db.insert(userRefreshTokens).values({
    userId,
    familyId: familyId ?? crypto.randomUUID(),
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + USER_REFRESH_TTL_MS),
  });
  return raw;
}

export interface UserRefreshResult {
  userId: number;
  accessToken: string;
  refreshToken: string;
}

/** Rotate; reuse of an already-rotated token revokes the whole family. */
export async function rotateUserRefreshToken(
  db: Db,
  presented: string,
): Promise<UserRefreshResult | null> {
  const [row] = await db
    .select()
    .from(userRefreshTokens)
    .where(eq(userRefreshTokens.tokenHash, hashToken(presented)))
    .limit(1);
  if (!row) return null;

  const now = new Date();
  if (row.revokedAt || row.replacedById !== null) {
    await db
      .update(userRefreshTokens)
      .set({ revokedAt: now })
      .where(
        and(eq(userRefreshTokens.familyId, row.familyId), isNull(userRefreshTokens.revokedAt)),
      );
    return null;
  }
  if (row.expiresAt < now) return null;

  const rawNext = crypto.randomBytes(48).toString('base64url');
  const [next] = await db
    .insert(userRefreshTokens)
    .values({
      userId: row.userId,
      familyId: row.familyId,
      tokenHash: hashToken(rawNext),
      expiresAt: new Date(Date.now() + USER_REFRESH_TTL_MS),
    })
    .returning({ id: userRefreshTokens.id });

  await db
    .update(userRefreshTokens)
    .set({ revokedAt: now, replacedById: next!.id })
    .where(eq(userRefreshTokens.id, row.id));

  return {
    userId: row.userId,
    accessToken: issueUserAccessToken(row.userId),
    refreshToken: rawNext,
  };
}

export async function revokeUserRefreshToken(db: Db, presented: string): Promise<void> {
  const [row] = await db
    .select({ familyId: userRefreshTokens.familyId })
    .from(userRefreshTokens)
    .where(eq(userRefreshTokens.tokenHash, hashToken(presented)))
    .limit(1);
  if (!row) return;
  await db
    .update(userRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(userRefreshTokens.familyId, row.familyId), isNull(userRefreshTokens.revokedAt)));
}
