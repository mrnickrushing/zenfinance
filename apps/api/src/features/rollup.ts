import crypto from 'node:crypto';
import { and, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { accounts, featureRollups, items, transactionEnrichments, transactions, users } from '../db/schema.js';
import { NON_SPEND_CATEGORIES } from '../enrichment/categories.js';

const DAY_MS = 86400000;
const TOTAL_CATEGORY = '_total';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday (UTC) of the ISO week containing `d`. */
export function mondayOf(d: Date): Date {
  const day = d.getUTCDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() + diff);
  return monday;
}

function aggregateId(userId: number, weekStart: string, metric: string, category: string): string {
  return crypto.createHash('sha256').update(`${userId}:${weekStart}:${metric}:${category}`).digest('hex');
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

interface RollupRow {
  metric: string;
  category: string;
  valueCents: number | null;
  valueRatio: number | null;
}

/**
 * Compute one user's feature-store rollups for the ISO week starting
 * `weekStart` (Monday, UTC) — PLAN §4 Stage 3. Idempotent: re-running for
 * the same week upserts in place via the stable `aggregateId`.
 */
export async function computeRollupsForWeek(db: Db, userId: number, weekStart: Date): Promise<void> {
  const weekStartStr = isoDate(weekStart);
  const weekEndStr = isoDate(new Date(weekStart.getTime() + 7 * DAY_MS));

  const rows = await db
    .select({
      amountCents: transactions.amountCents,
      postedDate: transactions.postedDate,
      category: transactionEnrichments.category,
      isDiscretionary: transactionEnrichments.isDiscretionary,
      isRecurring: transactionEnrichments.isRecurring,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(items, eq(accounts.itemId, items.id))
    .leftJoin(
      transactionEnrichments,
      and(eq(transactionEnrichments.transactionId, transactions.id), isNull(transactionEnrichments.supersededAt)),
    )
    .where(
      and(
        eq(items.userId, userId),
        isNull(transactions.removedAt),
        isNull(transactions.supersededAt),
        eq(transactions.pending, false),
        gte(transactions.postedDate, weekStartStr),
        lt(transactions.postedDate, weekEndStr),
      ),
    );

  const spendByCategory = new Map<string, number>();
  const dailyTotals = new Map<string, number>();
  let discretionarySpend = 0;
  let recurringSpend = 0;
  let incomeTotal = 0;

  for (const row of rows) {
    if (!row.category) continue; // not yet enriched — excluded until the next run
    const isSpend = !NON_SPEND_CATEGORIES.has(row.category);
    if (row.category === 'INCOME') incomeTotal += -row.amountCents;
    if (!isSpend) continue;

    spendByCategory.set(row.category, (spendByCategory.get(row.category) ?? 0) + row.amountCents);
    dailyTotals.set(row.postedDate, (dailyTotals.get(row.postedDate) ?? 0) + row.amountCents);
    if (row.isDiscretionary) discretionarySpend += row.amountCents;
    if (row.isRecurring) recurringSpend += row.amountCents;
  }

  const totalSpend = [...spendByCategory.values()].reduce((a, b) => a + b, 0);
  const volatility = stddev([...dailyTotals.values()]);

  const results: RollupRow[] = [
    ...[...spendByCategory.entries()].map(([category, valueCents]) => ({
      metric: 'category_spend',
      category,
      valueCents,
      valueRatio: null,
    })),
    { metric: 'total_spend', category: TOTAL_CATEGORY, valueCents: totalSpend, valueRatio: null },
    {
      metric: 'discretionary_ratio',
      category: TOTAL_CATEGORY,
      valueCents: null,
      valueRatio: totalSpend > 0 ? discretionarySpend / totalSpend : 0,
    },
    {
      metric: 'recurring_load',
      category: TOTAL_CATEGORY,
      valueCents: null,
      valueRatio: totalSpend > 0 ? recurringSpend / totalSpend : 0,
    },
    { metric: 'income_total', category: TOTAL_CATEGORY, valueCents: incomeTotal, valueRatio: null },
    { metric: 'volatility', category: TOTAL_CATEGORY, valueCents: Math.round(volatility), valueRatio: null },
  ];

  for (const r of results) {
    await db
      .insert(featureRollups)
      .values({
        aggregateId: aggregateId(userId, weekStartStr, r.metric, r.category),
        userId,
        weekStart: weekStartStr,
        metric: r.metric,
        category: r.category,
        valueCents: r.valueCents,
        valueRatio: r.valueRatio,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [featureRollups.userId, featureRollups.weekStart, featureRollups.metric, featureRollups.category],
        set: { valueCents: r.valueCents, valueRatio: r.valueRatio, computedAt: new Date() },
      });
  }
}

/**
 * The user's recent average weekly net savings (income − total spend) over the
 * last `weeks` weeks with data. Used for goal pacing/projection. 0 when there
 * are no weeks or the user isn't net-saving on average.
 */
export async function getRecentWeeklyNetCents(db: Db, userId: number, weeks = 4): Promise<number> {
  const rows = await db
    .select({
      weekStart: featureRollups.weekStart,
      metric: featureRollups.metric,
      valueCents: featureRollups.valueCents,
    })
    .from(featureRollups)
    .where(
      and(
        eq(featureRollups.userId, userId),
        eq(featureRollups.category, '_total'),
        inArray(featureRollups.metric, ['income_total', 'total_spend']),
      ),
    );
  const distinctWeeks = [...new Set(rows.map((r) => r.weekStart))].sort().reverse().slice(0, weeks);
  if (distinctWeeks.length === 0) return 0;
  let net = 0;
  for (const w of distinctWeeks) {
    const income = rows.find((r) => r.weekStart === w && r.metric === 'income_total')?.valueCents ?? 0;
    const spend = rows.find((r) => r.weekStart === w && r.metric === 'total_spend')?.valueCents ?? 0;
    net += income - spend;
  }
  return Math.round(net / distinctWeeks.length);
}

/**
 * Compute rollups for the last `weeks` ISO weeks for one user. Used at link
 * time so the first-look brief has category data to work from (the nightly
 * job hasn't run yet). Idempotent.
 */
export async function computeRecentRollups(db: Db, userId: number, weeks = 12): Promise<void> {
  const current = mondayOf(new Date());
  for (let i = 0; i < weeks; i++) {
    await computeRollupsForWeek(db, userId, new Date(current.getTime() - i * 7 * DAY_MS));
  }
}

/**
 * Nightly driver: recompute the current (in-progress) and previous
 * (just-completed) ISO week for every user who has linked at least one
 * item. Cheap and idempotent — safe to re-run.
 */
export async function runNightlyRollupsForAllUsers(db: Db): Promise<void> {
  const rows = await db
    .selectDistinct({ userId: items.userId })
    .from(items)
    .innerJoin(users, eq(items.userId, users.id));

  const currentWeekStart = mondayOf(new Date());
  const previousWeekStart = new Date(currentWeekStart.getTime() - 7 * DAY_MS);

  for (const { userId } of rows) {
    await computeRollupsForWeek(db, userId, previousWeekStart);
    await computeRollupsForWeek(db, userId, currentWeekStart);
  }
}
