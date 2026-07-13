import { and, desc, eq } from 'drizzle-orm';
import type { ZenScoreComponent, ZenScoreView } from '@zenfinance/shared';
import type { Db } from '../db/client.js';
import { featureRollups, goals } from '../db/schema.js';
import { computeGoalPacing } from './goals.js';

/**
 * The Zen Score (§4) turns real signals into a single 0–100 wellness number
 * plus three components the details screen already implies:
 *
 *  - Mindful Spending  — how small discretionary spend is as a share of outflow
 *  - Growth & Savings  — savings rate blended with goal pacing
 *  - Consistency       — how many recent weeks landed "on track"
 *
 * Every input is a code-computed weekly rollup or goal-pacing figure — no LLM,
 * no hardcoded number. Components with no data are `null` and drop out of the
 * weighted average; with nothing to score at all, `score` is `null` and the UI
 * shows an onboarding caption instead of a fake figure.
 */

const RECENT_WEEKS = 6;
const NET_SAVINGS_WEEKS = 4;

// Per-component floor so a rough week reads as "room to grow", not "failing".
const COMPONENT_FLOOR = 20;

const WEIGHTS: Record<ZenScoreComponent['key'], number> = {
  mindful_spending: 0.35,
  growth_savings: 0.4,
  consistency: 0.25,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Map a value onto 0..100 between a "worst" and "best" anchor (either order). */
function scaleTo100(value: number, worst: number, best: number): number {
  if (best === worst) return 50;
  return clamp(((value - worst) / (best - worst)) * 100, 0, 100);
}

interface WeekFigures {
  income: number | null;
  spend: number | null;
  discretionaryRatio: number | null;
}

function captionFor(score: number | null): string {
  if (score === null) return 'Link an account to start growing your score.';
  if (score >= 80) return 'Your financial wellness is blooming.';
  if (score >= 60) return 'Steady growth — keep the rhythm going.';
  if (score >= 40) return 'Taking root. Small steps are adding up.';
  return 'Planting seeds. One calm move at a time.';
}

export async function computeZenScore(db: Db, userId: number): Promise<ZenScoreView> {
  const rollups = await db
    .select({
      weekStart: featureRollups.weekStart,
      metric: featureRollups.metric,
      valueCents: featureRollups.valueCents,
      valueRatio: featureRollups.valueRatio,
    })
    .from(featureRollups)
    .where(and(eq(featureRollups.userId, userId), eq(featureRollups.category, '_total')))
    .orderBy(desc(featureRollups.weekStart));

  const weeks = [...new Set(rollups.map((r) => r.weekStart))].sort().reverse().slice(0, RECENT_WEEKS);
  const figuresByWeek = new Map<string, WeekFigures>();
  for (const week of weeks) {
    const at = (metric: string) => rollups.find((r) => r.weekStart === week && r.metric === metric) ?? null;
    figuresByWeek.set(week, {
      income: at('income_total')?.valueCents ?? null,
      spend: at('total_spend')?.valueCents ?? null,
      discretionaryRatio: at('discretionary_ratio')?.valueRatio ?? null,
    });
  }
  const figures = [...figuresByWeek.values()];

  // recent average weekly net savings — also feeds goal pacing.
  const netWeeks = figures
    .slice(0, NET_SAVINGS_WEEKS)
    .filter((f) => f.income !== null || f.spend !== null);
  const recentWeeklyNetCents =
    netWeeks.length > 0
      ? Math.round(netWeeks.reduce((sum, f) => sum + ((f.income ?? 0) - (f.spend ?? 0)), 0) / netWeeks.length)
      : 0;

  // --- Mindful Spending ---
  const discRatios = figures.map((f) => f.discretionaryRatio).filter((r): r is number => r !== null);
  let mindful: number | null = null;
  let mindfulDetail = 'Link accounts so we can read your spending mix.';
  if (discRatios.length > 0) {
    const avg = discRatios.reduce((a, b) => a + b, 0) / discRatios.length;
    mindful = Math.round(clamp(scaleTo100(avg, 0.6, 0.15), COMPONENT_FLOOR, 100));
    mindfulDetail = `Discretionary spending is about ${Math.round(avg * 100)}% of your outflow.`;
  }

  // --- Growth & Savings: savings rate blended with goal pacing ---
  const incomeWeeks = figures.filter((f) => (f.income ?? 0) > 0);
  let savingsScore: number | null = null;
  let savingsRatePct: number | null = null;
  if (incomeWeeks.length > 0) {
    const totalIncome = incomeWeeks.reduce((s, f) => s + (f.income ?? 0), 0);
    const totalNet = incomeWeeks.reduce((s, f) => s + ((f.income ?? 0) - (f.spend ?? 0)), 0);
    const rate = totalNet / totalIncome;
    savingsRatePct = Math.round(rate * 100);
    savingsScore = clamp(scaleTo100(rate, 0, 0.2), COMPONENT_FLOOR, 100);
  }

  const goalRows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.status, 'active')));
  let goalScore: number | null = null;
  let onTrackGoals = 0;
  if (goalRows.length > 0) {
    const statusBase: Record<string, number> = {
      ahead: 100,
      on_track: 90,
      no_deadline: 70,
      unknown: 45,
      behind: 30,
    };
    let sum = 0;
    for (const goal of goalRows) {
      const pacing = computeGoalPacing(goal, recentWeeklyNetCents);
      if (pacing.pacingStatus === 'on_track' || pacing.pacingStatus === 'ahead') onTrackGoals++;
      const base = statusBase[pacing.pacingStatus] ?? 45;
      sum += 0.6 * base + 0.4 * clamp(pacing.progressRatio, 0, 1) * 100;
    }
    goalScore = clamp(sum / goalRows.length, COMPONENT_FLOOR, 100);
  }

  let growth: number | null = null;
  let growthDetail = 'Add income and a goal to track your growth.';
  if (savingsScore !== null && goalScore !== null) {
    growth = Math.round(0.6 * savingsScore + 0.4 * goalScore);
    growthDetail = `Saving about ${savingsRatePct}% of income · ${onTrackGoals}/${goalRows.length} goals on track.`;
  } else if (savingsScore !== null) {
    growth = Math.round(savingsScore);
    growthDetail = `Saving about ${savingsRatePct}% of income.`;
  } else if (goalScore !== null) {
    growth = Math.round(goalScore);
    growthDetail = `${onTrackGoals}/${goalRows.length} goals on track.`;
  }

  // --- Consistency: how many recent weeks landed on track ---
  const scoredWeeks = figures.filter((f) => f.income !== null || f.spend !== null);
  let consistency: number | null = null;
  let consistencyDetail = 'A few weeks of activity unlocks this.';
  if (scoredWeeks.length >= 2) {
    const onTrack = scoredWeeks.filter((f) => {
      const net = (f.income ?? 0) - (f.spend ?? 0);
      const discOk = f.discretionaryRatio === null || f.discretionaryRatio <= 0.5;
      return net >= 0 && discOk;
    }).length;
    consistency = Math.round(clamp((onTrack / scoredWeeks.length) * 100, COMPONENT_FLOOR, 100));
    consistencyDetail = `${onTrack} of your last ${scoredWeeks.length} weeks stayed on track.`;
  }

  const components: ZenScoreComponent[] = [
    { key: 'mindful_spending', label: 'Mindful Spending', value: mindful, detail: mindfulDetail },
    { key: 'growth_savings', label: 'Growth & Savings', value: growth, detail: growthDetail },
    { key: 'consistency', label: 'Consistency', value: consistency, detail: consistencyDetail },
  ];

  const available = components.filter((c) => c.value !== null);
  let score: number | null = null;
  if (available.length > 0) {
    const weightSum = available.reduce((s, c) => s + WEIGHTS[c.key], 0);
    const weighted = available.reduce((s, c) => s + (c.value as number) * WEIGHTS[c.key], 0);
    score = Math.round(weighted / weightSum);
  }

  return { score, caption: captionFor(score), components };
}
