import { labelFor } from '../enrichment/categories.js';
import { computeGoalPacing } from '../coaching/goals.js';
import type {
  CitableFact,
  CoachingContext,
  ContextAnomaly,
  ContextCategory,
  ContextRecurring,
} from '../coaching/types.js';

// A synthetic persona: a fully-formed coaching context plus the golden
// expectation a correct brief must satisfy (PLAN §4: "~50 synthetic user
// personas with golden expectations"). The context is internally consistent —
// every aggregate id a downstream brief could cite appears in `facts` with a
// matching amount — so the provenance guard is a real test, not a rubber stamp.
export interface Persona {
  id: string;
  description: string;
  context: CoachingContext;
  // The fact the deterministic providers should build the brief around.
  expectedPrimaryAggregateId: string;
}

// Discretionary categories to draw from (all have defaultDiscretionary = true).
const DISCRETIONARY = [
  'RESTAURANTS_AND_DINING',
  'COFFEE_SHOPS',
  'ENTERTAINMENT',
  'SUBSCRIPTIONS_AND_STREAMING',
  'CLOTHING',
  'RIDESHARE_AND_TAXI',
  'BARS_AND_ALCOHOL',
  'FAST_FOOD',
];

const RECURRING_MERCHANTS = ['Netflix', 'Spotify', 'Planet Fitness', 'Hulu', 'Adobe', 'NYT'];

// Small seeded LCG so personas are varied but fully deterministic.
function rng(seed: number): () => number {
  let s = seed * 2654435761 + 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function buildPersona(seed: number): Persona {
  const rand = rng(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  const kind: 'first_look' | 'weekly_brief' = seed % 5 === 0 ? 'first_look' : 'weekly_brief';
  const weekStart = '2026-06-29';
  const facts: CitableFact[] = [];

  // --- 1..4 discretionary categories, always at least one ---
  const nCats = 1 + (seed % 4);
  const usedCats = new Set<string>();
  const categories: ContextCategory[] = [];
  for (let i = 0; i < nCats; i++) {
    let cat = pick(DISCRETIONARY);
    let guard = 0;
    while (usedCats.has(cat) && guard++ < 10) cat = pick(DISCRETIONARY);
    if (usedCats.has(cat)) continue;
    usedCats.add(cat);
    const amount = between(2000, 45000);
    const aggId = `p${seed}-cat-${cat}`;
    facts.push({ aggregateId: aggId, amountCents: amount, label: `${labelFor(cat)} spend this week`, kind: 'category_spend' });

    let deltaCents: number | null = null;
    let deltaAggregateId: string | null = null;
    if (rand() > 0.4) {
      deltaCents = between(-8000, 8000);
      deltaAggregateId = `p${seed}-catdelta-${cat}`;
      facts.push({
        aggregateId: deltaAggregateId,
        amountCents: Math.abs(deltaCents),
        label: `${labelFor(cat)} change vs last week`,
        kind: 'category_delta',
      });
    }
    categories.push({ category: cat, label: labelFor(cat), amountCents: amount, aggregateId: aggId, deltaCents, deltaAggregateId });
  }
  categories.sort((a, b) => b.amountCents - a.amountCents);
  const expectedPrimaryAggregateId = categories[0]!.aggregateId;

  // --- total spend + income ---
  const totalSpend = categories.reduce((s, c) => s + c.amountCents, 0) + between(5000, 40000);
  facts.push({ aggregateId: `p${seed}-total`, amountCents: totalSpend, label: 'Total spend this week', kind: 'total_spend' });
  const hasIncome = seed % 3 !== 0;
  const incomeCents = hasIncome ? between(200000, 500000) : 0;
  if (hasIncome) {
    facts.push({ aggregateId: `p${seed}-income`, amountCents: incomeCents, label: 'Income this week', kind: 'income_total' });
  }

  // --- 0..3 recurring charges ---
  const nRec = seed % 4;
  const recurringCharges: ContextRecurring[] = [];
  for (let i = 0; i < nRec; i++) {
    const merchant = pick(RECURRING_MERCHANTS);
    const amount = between(500, 3000);
    const aggId = `p${seed}-rec-${i}`;
    facts.push({ aggregateId: aggId, amountCents: amount, label: `${merchant} recurring charge (monthly)`, kind: 'recurring_charge' });
    recurringCharges.push({ merchantClean: merchant, cadence: 'monthly', avgAmountCents: amount, aggregateId: aggId });
  }

  // --- 0..2 anomalies ---
  const nAnom = seed % 3;
  const anomalyList: ContextAnomaly[] = [];
  for (let i = 0; i < nAnom; i++) {
    const amount = between(3000, 20000);
    const aggId = `p${seed}-anom-${i}`;
    const title = i === 0 ? 'Possible duplicate charge' : 'Unusually large charge';
    facts.push({ aggregateId: aggId, amountCents: amount, label: title, kind: 'anomaly' });
    anomalyList.push({ kind: 'duplicate_charge', title, detail: `A $${(amount / 100).toFixed(2)} charge worth a look.`, amountCents: amount, aggregateId: aggId });
  }

  // --- 0..2 goals with varied pacing ---
  const nGoals = seed % 3;
  const recentWeeklyNetCents = hasIncome ? incomeCents - totalSpend : between(-5000, 3000);
  const goals = [];
  for (let i = 0; i < nGoals; i++) {
    const target = between(50000, 500000);
    const current = Math.floor(target * rand() * 0.8);
    const daysOut = between(30, 300);
    const goalRow = {
      id: seed * 10 + i,
      userId: seed,
      name: i === 0 ? 'Emergency fund' : 'Vacation',
      targetAmountCents: target,
      currentAmountCents: current,
      targetDate: new Date(Date.now() + daysOut * 86400000).toISOString().slice(0, 10),
      priority: i + 1,
      status: 'active' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const pacing = computeGoalPacing(goalRow, recentWeeklyNetCents);
    if (pacing.remainingAmountCents > 0) {
      facts.push({
        aggregateId: `p${seed}-goal-${goalRow.id}`,
        amountCents: pacing.remainingAmountCents,
        label: `Remaining to reach "${goalRow.name}"`,
        kind: 'goal_remaining',
      });
    }
    goals.push(pacing);
  }

  const discretionaryRatio = Math.min(1, categories.reduce((s, c) => s + c.amountCents, 0) / Math.max(1, totalSpend));

  const context: CoachingContext = {
    userId: seed,
    kind,
    weekStart,
    weeksOfData: between(2, 12),
    profile: { discretionaryRatio, recentWeeklyNetCents, hasIncome },
    goals,
    topDiscretionaryCategories: categories,
    recurringCharges,
    anomalies: anomalyList,
    facts,
  };

  return {
    id: `persona-${seed}`,
    description: `${kind}, ${categories.length} cat / ${recurringCharges.length} rec / ${anomalyList.length} anom / ${goals.length} goal`,
    context,
    expectedPrimaryAggregateId,
  };
}

export const PERSONAS: Persona[] = Array.from({ length: 50 }, (_, i) => buildPersona(i + 1));
