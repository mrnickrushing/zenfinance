import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { anomalies, featureRollups, goals, recurringStreams } from '../db/schema.js';
import { defaultDiscretionaryFor, labelFor, NON_SPEND_CATEGORIES } from '../enrichment/categories.js';
import { computeGoalPacing, type GoalPacing } from './goals.js';
import type {
  CitableFact,
  CoachingContext,
  ContextAnomaly,
  ContextCategory,
  ContextRecurring,
} from './types.js';

const TOP_CATEGORIES = 5;
const NET_SAVINGS_WEEKS = 4;

function derivedAggregateId(userId: number, kind: string, key: string): string {
  return crypto.createHash('sha256').update(`derived:${userId}:${kind}:${key}`).digest('hex');
}

interface WeeklyRollup {
  weekStart: string;
  metric: string;
  category: string;
  valueCents: number | null;
  valueRatio: number | null;
  aggregateId: string;
}

/**
 * Assemble the deterministic coaching context (§4 Stage 4). Everything the
 * model is later allowed to cite comes from `facts`, whose amounts and stable
 * aggregate ids are computed here in code — the model never does arithmetic
 * and never sees raw transactions.
 */
export async function assembleCoachingContext(
  db: Db,
  userId: number,
  kind: 'first_look' | 'weekly_brief',
): Promise<CoachingContext> {
  const rollups = (await db
    .select({
      weekStart: featureRollups.weekStart,
      metric: featureRollups.metric,
      category: featureRollups.category,
      valueCents: featureRollups.valueCents,
      valueRatio: featureRollups.valueRatio,
      aggregateId: featureRollups.aggregateId,
    })
    .from(featureRollups)
    .where(eq(featureRollups.userId, userId))
    .orderBy(desc(featureRollups.weekStart))) as WeeklyRollup[];

  const weeks = [...new Set(rollups.map((r) => r.weekStart))].sort().reverse(); // newest first
  const latestWeek = weeks[0] ?? null;
  const priorWeek = weeks[1] ?? null;

  const rollupAt = (week: string | null, metric: string, category = '_total'): WeeklyRollup | null =>
    week === null
      ? null
      : rollups.find((r) => r.weekStart === week && r.metric === metric && r.category === category) ?? null;

  // --- profile ---
  const discretionaryRatio = rollupAt(latestWeek, 'discretionary_ratio')?.valueRatio ?? null;
  const hasIncome = rollups.some((r) => r.metric === 'income_total' && (r.valueCents ?? 0) > 0);

  // Recent average weekly net savings (income − spend) over the last few weeks.
  const recentWeeks = weeks.slice(0, NET_SAVINGS_WEEKS);
  let netSum = 0;
  let netCount = 0;
  for (const w of recentWeeks) {
    const income = rollupAt(w, 'income_total')?.valueCents ?? 0;
    const spend = rollupAt(w, 'total_spend')?.valueCents ?? 0;
    netSum += income - spend;
    netCount++;
  }
  const recentWeeklyNetCents = netCount > 0 ? Math.round(netSum / netCount) : 0;

  // --- goals + pacing ---
  const goalRows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.status, 'active')))
    .orderBy(goals.priority);
  const goalPacings: GoalPacing[] = goalRows.map((g) => computeGoalPacing(g, recentWeeklyNetCents));

  // --- top discretionary categories (latest week) with week-over-week deltas ---
  const facts: CitableFact[] = [];
  const topDiscretionaryCategories: ContextCategory[] = [];

  const latestCategorySpend = rollups
    .filter((r) => r.weekStart === latestWeek && r.metric === 'category_spend')
    .filter((r) => defaultDiscretionaryFor(r.category) && !NON_SPEND_CATEGORIES.has(r.category))
    .sort((a, b) => (b.valueCents ?? 0) - (a.valueCents ?? 0))
    .slice(0, TOP_CATEGORIES);

  for (const row of latestCategorySpend) {
    const amountCents = row.valueCents ?? 0;
    const label = labelFor(row.category);
    facts.push({ aggregateId: row.aggregateId, amountCents, label: `${label} spend this week`, kind: 'category_spend' });

    let deltaCents: number | null = null;
    let deltaAggregateId: string | null = null;
    const prior = rollups.find(
      (r) => r.weekStart === priorWeek && r.metric === 'category_spend' && r.category === row.category,
    );
    if (prior) {
      deltaCents = amountCents - (prior.valueCents ?? 0);
      deltaAggregateId = derivedAggregateId(userId, 'category_delta', `${latestWeek}:${row.category}`);
      facts.push({
        aggregateId: deltaAggregateId,
        amountCents: Math.abs(deltaCents),
        label: `${label} change vs last week`,
        kind: 'category_delta',
      });
    }

    topDiscretionaryCategories.push({
      category: row.category,
      label,
      amountCents,
      aggregateId: row.aggregateId,
      deltaCents,
      deltaAggregateId,
    });
  }

  // total spend + income facts for the latest week
  const totalSpend = rollupAt(latestWeek, 'total_spend');
  if (totalSpend) {
    facts.push({
      aggregateId: totalSpend.aggregateId,
      amountCents: totalSpend.valueCents ?? 0,
      label: 'Total spend this week',
      kind: 'total_spend',
    });
  }
  const income = rollupAt(latestWeek, 'income_total');
  if (income && (income.valueCents ?? 0) > 0) {
    facts.push({
      aggregateId: income.aggregateId,
      amountCents: income.valueCents ?? 0,
      label: 'Income this week',
      kind: 'income_total',
    });
  }

  // --- recurring charges ---
  const recurringRows = await db
    .select()
    .from(recurringStreams)
    .where(and(eq(recurringStreams.userId, userId), eq(recurringStreams.active, true)))
    .orderBy(desc(recurringStreams.avgAmountCents));
  const recurringCharges: ContextRecurring[] = recurringRows.slice(0, 8).map((r) => {
    const aggregateId = derivedAggregateId(userId, 'recurring', String(r.id));
    facts.push({
      aggregateId,
      amountCents: r.avgAmountCents,
      label: `${r.merchantClean} recurring charge (${r.cadence})`,
      kind: 'recurring_charge',
    });
    return { merchantClean: r.merchantClean, cadence: r.cadence, avgAmountCents: r.avgAmountCents, aggregateId };
  });

  // --- open anomalies ---
  const anomalyRows = await db
    .select()
    .from(anomalies)
    .where(and(eq(anomalies.userId, userId), eq(anomalies.status, 'open')))
    .orderBy(desc(anomalies.amountCents))
    .limit(8);
  const contextAnomalies: ContextAnomaly[] = anomalyRows.map((a) => {
    const aggregateId = derivedAggregateId(userId, 'anomaly', String(a.id));
    facts.push({ aggregateId, amountCents: a.amountCents, label: a.title, kind: 'anomaly' });
    return { kind: a.kind, title: a.title, detail: a.detail, amountCents: a.amountCents, aggregateId };
  });

  // --- goal-remaining facts ---
  for (const g of goalPacings) {
    if (g.remainingAmountCents > 0) {
      const aggregateId = derivedAggregateId(userId, 'goal_remaining', String(g.goalId));
      facts.push({
        aggregateId,
        amountCents: g.remainingAmountCents,
        label: `Remaining to reach "${g.name}"`,
        kind: 'goal_remaining',
      });
    }
  }

  return {
    userId,
    kind,
    weekStart: latestWeek,
    weeksOfData: weeks.length,
    profile: { discretionaryRatio, recentWeeklyNetCents, hasIncome },
    goals: goalPacings,
    topDiscretionaryCategories,
    recurringCharges,
    anomalies: contextAnomalies,
    facts,
  };
}

export { derivedAggregateId };
