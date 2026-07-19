import type { LaunchContentStatsView } from '@zenfinance/shared';
import { eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db/client.js';
import {
  billingEntitlements,
  items,
  moneyWins,
  recurringStreams,
  referralRedemptions,
} from '../db/schema.js';

const MINIMUM_SAMPLE_SIZE = 10;
const CACHE_TTL_MS = 5 * 60_000;

export function createContentRouter(): ReturnType<typeof Router> {
  const router = Router();
  let cached: { expiresAt: number; value: LaunchContentStatsView } | null = null;
  let pending: Promise<LaunchContentStatsView> | null = null;
  const launchStatsLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many launch stats requests. Try again shortly.' } },
  });

  router.get('/api/content/launch-stats', launchStatsLimiter, async (_req, res) => {
    const now = Date.now();
    if (!cached || cached.expiresAt <= now) {
      pending ??= loadLaunchStats().then((value) => {
        cached = { expiresAt: Date.now() + CACHE_TTL_MS, value };
        return value;
      }).finally(() => {
        pending = null;
      });
      await pending;
    }
    const view = cached!.value;
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=300');
    res.json(view);
  });

  return router;
}

async function loadLaunchStats(): Promise<LaunchContentStatsView> {
  const [[linkedUsers], [premiumUsers], [recurring], [verifiedWins], [referrals]] = await Promise.all([
    db.select({ n: sql<number>`count(distinct ${items.userId})` }).from(items),
    db
      .select({ n: sql<number>`count(distinct ${billingEntitlements.userId})` })
      .from(billingEntitlements)
      .where(sql`${billingEntitlements.status} in ('trialing', 'active', 'grace_period') and (${billingEntitlements.expiresAt} is null or ${billingEntitlements.expiresAt} > now())`),
    db
      .select({
        userCount: sql<number>`count(distinct ${recurringStreams.userId})`,
        streamCount: sql<number>`count(*)`,
        monthlyCents: sql<number>`coalesce(sum(${recurringStreams.avgAmountCents}), 0)`,
      })
      .from(recurringStreams)
      .where(sql`${recurringStreams.active} = true and ${recurringStreams.avgAmountCents} > 0`),
    db
      .select({
        userCount: sql<number>`count(distinct ${moneyWins.userId})`,
        amountCents: sql<number>`coalesce(sum(${moneyWins.amountCents}), 0)`,
      })
      .from(moneyWins)
      .where(eq(moneyWins.status, 'verified')),
    db.select({ n: sql<number>`count(*)` }).from(referralRedemptions),
  ]);
  const linkedCount = Number(linkedUsers?.n ?? 0);
  const recurringUserCount = Number(recurring?.userCount ?? 0);
  const verifiedUserCount = Number(verifiedWins?.userCount ?? 0);
  const publishable = linkedCount >= MINIMUM_SAMPLE_SIZE;
  return {
    generatedAt: new Date().toISOString(),
    sampleSize: linkedCount,
    publishable,
    minimumSampleSize: MINIMUM_SAMPLE_SIZE,
    metrics: publishable
      ? {
          linkedUsers: linkedCount,
          premiumUsers: Number(premiumUsers?.n ?? 0),
          avgRecurringStreamsPerLinkedUser: recurringUserCount ? Number(recurring?.streamCount ?? 0) / recurringUserCount : 0,
          avgRecurringMonthlyCentsPerLinkedUser: recurringUserCount ? Math.round(Number(recurring?.monthlyCents ?? 0) / recurringUserCount) : 0,
          avgVerifiedMoneyWinsCentsPerUser: verifiedUserCount ? Math.round(Number(verifiedWins?.amountCents ?? 0) / verifiedUserCount) : 0,
          referralRedemptions: Number(referrals?.n ?? 0),
        }
      : null,
  };
}
