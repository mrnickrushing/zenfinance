import {
  freelancerProfileUpdateSchema,
  type FreelancerIncomeMonthView,
  type FreelancerProfileUpdateInput,
  type FreelancerProfileView,
  type FreelancerRecommendationView,
  type FreelancerSummaryView,
} from '@zenfinance/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { assertPremium } from '../billing/service.js';
import { db } from '../db/client.js';
import { accounts, freelancerProfiles, items, transactionEnrichments, transactions } from '../db/schema.js';
import { requireUser } from '../middleware/userAuth.js';
import { validateBody } from '../middleware/validate.js';

const FREELANCER_WINDOW_MONTHS = 6;
const ESSENTIAL_CATEGORIES = new Set([
  'bills',
  'debt',
  'education',
  'fees',
  'food_and_drink',
  'groceries',
  'healthcare',
  'home',
  'housing',
  'insurance',
  'loan_payments',
  'medical',
  'rent',
  'taxes',
  'transportation',
  'utilities',
]);
const CASH_ACCOUNT_TYPES = new Set(['depository', 'cash']);

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, months: number): Date {
  const copy = new Date(d);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function dateFromMonthKey(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`);
}

function cents(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${(Math.abs(amount) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function categoryKey(category: string | null): string {
  return (category ?? '').trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '_').replaceAll(/^_+|_+$/g, '');
}

function profileToView(row: typeof freelancerProfiles.$inferSelect): FreelancerProfileView {
  return {
    enabled: row.enabled,
    targetMonthlyIncomeCents: row.targetMonthlyIncomeCents,
    taxSetAsideBps: row.taxSetAsideBps,
    runwayTargetMonths: row.runwayTargetMonths,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getOrCreateProfile(userId: number): Promise<FreelancerProfileView> {
  const [created] = await db
    .insert(freelancerProfiles)
    .values({ userId })
    .onConflictDoNothing({ target: freelancerProfiles.userId })
    .returning();
  if (created) return profileToView(created);

  const [row] = await db.select().from(freelancerProfiles).where(eq(freelancerProfiles.userId, userId)).limit(1);
  return profileToView(row!);
}

async function updateProfile(userId: number, input: FreelancerProfileUpdateInput): Promise<FreelancerProfileView> {
  await getOrCreateProfile(userId);
  const [row] = await db
    .update(freelancerProfiles)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(freelancerProfiles.userId, userId))
    .returning();
  return profileToView(row!);
}

async function accountContext(userId: number): Promise<{
  accountIds: number[];
  cashBalanceCents: number | null;
}> {
  const rows = await db
    .select({
      id: accounts.id,
      type: accounts.type,
      currentBalanceCents: accounts.currentBalanceCents,
    })
    .from(accounts)
    .innerJoin(items, eq(accounts.itemId, items.id))
    .where(eq(items.userId, userId));

  const cashBalances = rows
    .filter((row) => CASH_ACCOUNT_TYPES.has(row.type) && row.currentBalanceCents !== null)
    .map((row) => row.currentBalanceCents ?? 0);

  return {
    accountIds: rows.map((row) => row.id),
    cashBalanceCents: cashBalances.length ? cashBalances.reduce((sum, amount) => sum + amount, 0) : null,
  };
}

function emptyMonths(start: Date): FreelancerIncomeMonthView[] {
  return Array.from({ length: FREELANCER_WINDOW_MONTHS }, (_, index) => ({
    month: monthKey(addMonths(start, index)),
    incomeCents: 0,
    essentialSpendCents: 0,
    netCents: 0,
  }));
}

function isEssentialSpend(category: string | null, isDiscretionary: boolean | null): boolean {
  if (isDiscretionary === true) return false;
  const key = categoryKey(category);
  if (!key) return true;
  if (ESSENTIAL_CATEGORIES.has(key)) return true;
  return [...ESSENTIAL_CATEGORIES].some((essential) => key.includes(essential));
}

async function buildSummary(userId: number): Promise<FreelancerSummaryView> {
  const profile = await getOrCreateProfile(userId);
  const { accountIds, cashBalanceCents } = await accountContext(userId);
  const now = new Date();
  const start = startOfMonth(addMonths(now, -(FREELANCER_WINDOW_MONTHS - 1)));
  const end = addMonths(start, FREELANCER_WINDOW_MONTHS);
  const months = emptyMonths(start);
  const byMonth = new Map(months.map((m) => [m.month, m]));

  if (accountIds.length > 0) {
    const rows = await db
      .select({
        amountCents: transactions.amountCents,
        postedDate: transactions.postedDate,
        category: transactionEnrichments.category,
        isDiscretionary: transactionEnrichments.isDiscretionary,
      })
      .from(transactions)
      .leftJoin(
        transactionEnrichments,
        and(eq(transactionEnrichments.transactionId, transactions.id), isNull(transactionEnrichments.supersededAt)),
      )
      .where(
        and(
          inArray(transactions.accountId, accountIds),
          isNull(transactions.removedAt),
          isNull(transactions.supersededAt),
          isNull(transactions.transferPairId),
          eq(transactions.pending, false),
          sql`${transactions.postedDate} >= ${isoDate(start)}`,
          sql`${transactions.postedDate} < ${isoDate(end)}`,
        ),
      );

    for (const row of rows) {
      const month = byMonth.get(monthKey(dateFromMonthKey(row.postedDate.slice(0, 7))));
      if (!month) continue;
      if (row.amountCents < 0) {
        month.incomeCents += Math.abs(row.amountCents);
      } else if (row.amountCents > 0 && isEssentialSpend(row.category, row.isDiscretionary)) {
        month.essentialSpendCents += row.amountCents;
      }
    }
  }

  for (const month of months) {
    month.netCents = month.incomeCents - month.essentialSpendCents;
  }

  const incomeValues = months.map((m) => m.incomeCents);
  const monthsWithIncome = incomeValues.filter((amount) => amount > 0).length;
  const totalIncome = incomeValues.reduce((sum, amount) => sum + amount, 0);
  const avgMonthlyIncomeCents = Math.round(totalIncome / FREELANCER_WINDOW_MONTHS);
  const minMonthlyIncomeCents = Math.min(...incomeValues);
  const maxMonthlyIncomeCents = Math.max(...incomeValues);
  const incomeVolatilityRatio =
    avgMonthlyIncomeCents > 0 ? Number(((maxMonthlyIncomeCents - minMonthlyIncomeCents) / avgMonthlyIncomeCents).toFixed(2)) : 0;
  const essentialMonthlySpendCents = Math.round(
    months.reduce((sum, month) => sum + month.essentialSpendCents, 0) / FREELANCER_WINDOW_MONTHS,
  );
  const estimatedTaxSetAsideMonthlyCents = Math.round((avgMonthlyIncomeCents * profile.taxSetAsideBps) / 10000);
  const runwayMonths =
    cashBalanceCents !== null && essentialMonthlySpendCents > 0
      ? Number((cashBalanceCents / essentialMonthlySpendCents).toFixed(1))
      : null;
  const runwayTargetGapCents =
    runwayMonths !== null && runwayMonths < profile.runwayTargetMonths
      ? Math.max(0, Math.round(profile.runwayTargetMonths * essentialMonthlySpendCents - (cashBalanceCents ?? 0)))
      : null;
  const targetMonthlyIncomeGapCents =
    profile.targetMonthlyIncomeCents !== null
      ? Math.max(0, profile.targetMonthlyIncomeCents - avgMonthlyIncomeCents)
      : null;
  const slowMonthIncomeCents = monthsWithIncome > 0 ? Math.min(...incomeValues.filter((amount) => amount > 0)) : 0;
  const nextSlowMonthBufferCents = Math.max(0, essentialMonthlySpendCents + estimatedTaxSetAsideMonthlyCents - slowMonthIncomeCents);

  const incomeConfidence: FreelancerSummaryView['incomeConfidence'] =
    monthsWithIncome === 0 ? 'none' : monthsWithIncome <= 2 ? 'low' : monthsWithIncome <= 4 ? 'medium' : 'high';
  const recommendations = buildRecommendations({
    profile,
    accountIds,
    avgMonthlyIncomeCents,
    essentialMonthlySpendCents,
    estimatedTaxSetAsideMonthlyCents,
    incomeVolatilityRatio,
    runwayMonths,
    runwayTargetGapCents,
    targetMonthlyIncomeGapCents,
    nextSlowMonthBufferCents,
  });

  return {
    generatedAt: now.toISOString(),
    windowStart: isoDate(start),
    windowEnd: isoDate(end),
    profile,
    months,
    avgMonthlyIncomeCents,
    minMonthlyIncomeCents,
    maxMonthlyIncomeCents,
    incomeVolatilityRatio,
    incomeConfidence,
    essentialMonthlySpendCents,
    cashBalanceCents,
    runwayMonths,
    runwayTargetGapCents,
    targetMonthlyIncomeGapCents,
    estimatedTaxSetAsideMonthlyCents,
    estimatedTaxSetAsideRateBps: profile.taxSetAsideBps,
    nextSlowMonthBufferCents,
    recommendations,
  };
}

function buildRecommendations(input: {
  profile: FreelancerProfileView;
  accountIds: number[];
  avgMonthlyIncomeCents: number;
  essentialMonthlySpendCents: number;
  estimatedTaxSetAsideMonthlyCents: number;
  incomeVolatilityRatio: number;
  runwayMonths: number | null;
  runwayTargetGapCents: number | null;
  targetMonthlyIncomeGapCents: number | null;
  nextSlowMonthBufferCents: number;
}): FreelancerRecommendationView[] {
  if (!input.profile.enabled) {
    return [
      {
        kind: 'link_accounts',
        severity: 'info',
        title: 'Freelancer Mode is paused',
        body: 'Turn it back on when you want income, runway, and estimated set-aside tracking.',
      },
    ];
  }
  if (input.accountIds.length === 0) {
    return [
      {
        kind: 'link_accounts',
        severity: 'warning',
        title: 'Link income accounts',
        body: 'Freelancer Mode needs linked checking or business accounts to calculate income stability and runway.',
      },
    ];
  }

  const recommendations: FreelancerRecommendationView[] = [];
  if (input.avgMonthlyIncomeCents > 0) {
    recommendations.push({
      kind: 'tax_set_aside',
      severity: 'info',
      title: 'Estimated tax set-aside',
      body: `At ${(input.profile.taxSetAsideBps / 100).toFixed(0)}%, set aside about ${cents(input.estimatedTaxSetAsideMonthlyCents)} per average month. This is planning math, not tax advice.`,
    });
  }
  if (input.runwayTargetGapCents !== null && input.runwayTargetGapCents > 0) {
    recommendations.push({
      kind: 'runway',
      severity: input.runwayMonths !== null && input.runwayMonths < 1 ? 'urgent' : 'warning',
      title: 'Build income runway',
      body: `Add ${cents(input.runwayTargetGapCents)} to cash reserves to reach ${input.profile.runwayTargetMonths} months of essential spend.`,
    });
  }
  if (input.targetMonthlyIncomeGapCents !== null && input.targetMonthlyIncomeGapCents > 0) {
    recommendations.push({
      kind: 'income_target',
      severity: 'warning',
      title: 'Income target gap',
      body: `Average monthly income is ${cents(input.targetMonthlyIncomeGapCents)} below your target. Use this gap for pipeline and rate planning.`,
    });
  }
  if (input.incomeVolatilityRatio >= 1.25 || input.nextSlowMonthBufferCents > 0) {
    recommendations.push({
      kind: 'income_volatility',
      severity: input.incomeVolatilityRatio >= 2 ? 'urgent' : 'warning',
      title: 'Plan for a slow month',
      body: `Keep at least ${cents(input.nextSlowMonthBufferCents)} available for essentials and estimated set-aside if income repeats its slowest recent month.`,
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      kind: 'runway',
      severity: 'info',
      title: 'Runway is on track',
      body: 'Income, cash runway, and essential spend are within the targets saved in Freelancer Mode.',
    });
  }
  return recommendations;
}

export function createFreelancerRouter(): ReturnType<typeof Router> {
  const router = Router();

  router.get('/api/freelancer/profile', requireUser, async (_req, res) => {
    const userId = res.locals.userId as number;
    const premium = await assertPremium(db, userId, 'freelancer_mode');
    if (!premium.ok) {
      res.status(402).json(premium.payload);
      return;
    }
    res.json(await getOrCreateProfile(userId));
  });

  router.patch(
    '/api/freelancer/profile',
    requireUser,
    validateBody(freelancerProfileUpdateSchema),
    async (_req, res) => {
      const userId = res.locals.userId as number;
      const premium = await assertPremium(db, userId, 'freelancer_mode');
      if (!premium.ok) {
        res.status(402).json(premium.payload);
        return;
      }
      res.json(await updateProfile(userId, res.locals.body as FreelancerProfileUpdateInput));
    },
  );

  router.get('/api/freelancer/summary', requireUser, async (_req, res) => {
    const userId = res.locals.userId as number;
    const premium = await assertPremium(db, userId, 'freelancer_mode');
    if (!premium.ok) {
      res.status(402).json(premium.payload);
      return;
    }
    res.json(await buildSummary(userId));
  });

  return router;
}
