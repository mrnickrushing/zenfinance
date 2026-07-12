import type { LaunchContentStatsView } from '@zenfinance/shared';
import { eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client.js';
import {
  billingEntitlements,
  items,
  moneyWins,
  recurringStreams,
  referralRedemptions,
} from '../db/schema.js';

const MINIMUM_SAMPLE_SIZE = 10;

export function createContentRouter(): ReturnType<typeof Router> {
  const router = Router();

  router.get('/api/content/launch-stats', async (_req, res) => {
    const [linkedUsers] = await db.select({ n: sql<number>`count(distinct ${items.userId})` }).from(items);
    const [premiumUsers] = await db
      .select({ n: sql<number>`count(distinct ${billingEntitlements.userId})` })
      .from(billingEntitlements)
      .where(sql`${billingEntitlements.status} in ('trialing', 'active', 'grace_period') and (${billingEntitlements.expiresAt} is null or ${billingEntitlements.expiresAt} > now())`);
    const [recurring] = await db
      .select({
        userCount: sql<number>`count(distinct ${recurringStreams.userId})`,
        streamCount: sql<number>`count(*)`,
        monthlyCents: sql<number>`coalesce(sum(${recurringStreams.avgAmountCents}), 0)`,
      })
      .from(recurringStreams)
      .where(sql`${recurringStreams.active} = true and ${recurringStreams.avgAmountCents} > 0`);
    const [verifiedWins] = await db
      .select({
        userCount: sql<number>`count(distinct ${moneyWins.userId})`,
        amountCents: sql<number>`coalesce(sum(${moneyWins.amountCents}), 0)`,
      })
      .from(moneyWins)
      .where(eq(moneyWins.status, 'verified'));
    const [referrals] = await db.select({ n: sql<number>`count(*)` }).from(referralRedemptions);
    const linkedCount = Number(linkedUsers?.n ?? 0);
    const recurringUserCount = Number(recurring?.userCount ?? 0);
    const verifiedUserCount = Number(verifiedWins?.userCount ?? 0);
    const publishable = linkedCount >= MINIMUM_SAMPLE_SIZE;
    const view: LaunchContentStatsView = {
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
    res.json(view);
  });

  return router;
}
