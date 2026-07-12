import { and, count, eq, ne } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { assertPremium, FREE_LIMITS, premiumRequiredPayload, userHasPremium } from '../billing/service.js';
import { db } from '../db/client.js';
import { goals, items } from '../db/schema.js';

export function requirePremium(feature: string) {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = res.locals.userId as number;
    const premium = await assertPremium(db, userId, feature);
    if (!premium.ok) {
      res.status(402).json(premium.payload);
      return;
    }
    next();
  };
}

export async function enforceItemLimit(userId: number): Promise<{ ok: true } | { ok: false; message: string }> {
  if (await userHasPremium(db, userId)) return { ok: true };
  const [row] = await db.select({ n: count() }).from(items).where(eq(items.userId, userId));
  const max = FREE_LIMITS.maxLinkedItems ?? Number.POSITIVE_INFINITY;
  if ((row?.n ?? 0) >= max) {
    return { ok: false, message: `Free accounts can link up to ${max} bank connections. Upgrade to ZenFinance Coach for unlimited accounts.` };
  }
  return { ok: true };
}

export async function enforceActiveGoalLimit(
  userId: number,
  options: { existingGoalId?: number; nextStatus?: 'active' | 'achieved' | 'archived' } = {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (await userHasPremium(db, userId)) return { ok: true };
  if (options.nextStatus && options.nextStatus !== 'active') return { ok: true };
  const [row] = await db
    .select({ n: count() })
    .from(goals)
    .where(
      options.existingGoalId
        ? and(eq(goals.userId, userId), eq(goals.status, 'active'), ne(goals.id, options.existingGoalId))
        : and(eq(goals.userId, userId), eq(goals.status, 'active')),
    );
  const max = FREE_LIMITS.maxActiveGoals ?? Number.POSITIVE_INFINITY;
  if ((row?.n ?? 0) >= max) {
    return { ok: false, message: `Free accounts can keep 1 active goal. Upgrade to ZenFinance Coach for multiple goals.` };
  }
  return { ok: true };
}

export function premiumRequiredResponse(res: Response, feature: string): void {
  res.status(402).json(premiumRequiredPayload(feature));
}
