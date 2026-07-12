import type { GoalPacing } from './goals.js';

// A ground-truth dollar figure the coach is allowed to cite. Every verified
// claim in a generated brief must reference one of these by `aggregateId`,
// and its amount must match (§4 provenance guard). `aggregateId`s from the
// feature store are reused verbatim; derived figures (deltas, goal remaining)
// get their own stable, deterministic ids.
export interface CitableFact {
  aggregateId: string;
  amountCents: number; // absolute value in cents
  label: string; // human-readable, e.g. "Dining & restaurants spend last week"
  kind:
    | 'category_spend'
    | 'category_delta'
    | 'total_spend'
    | 'income_total'
    | 'recurring_charge'
    | 'anomaly'
    | 'goal_remaining';
}

export interface ContextCategory {
  category: string;
  label: string;
  amountCents: number;
  aggregateId: string;
  deltaCents: number | null; // week-over-week change; null when no prior week
  deltaAggregateId: string | null;
}

export interface ContextRecurring {
  merchantClean: string;
  cadence: string;
  avgAmountCents: number;
  aggregateId: string;
}

export interface ContextAnomaly {
  kind: string;
  title: string;
  detail: string;
  amountCents: number;
  aggregateId: string;
}

// Everything the brief generator needs, assembled deterministically. The
// model receives a redacted, compact form of this (never raw transactions).
export interface CoachingContext {
  userId: number;
  kind: 'first_look' | 'weekly_brief';
  weekStart: string | null; // ISO Monday the brief covers; null for first_look
  weeksOfData: number;
  profile: {
    discretionaryRatio: number | null; // 0..1, latest week
    recentWeeklyNetCents: number; // income − spend, recent average
    hasIncome: boolean;
  };
  goals: GoalPacing[];
  topDiscretionaryCategories: ContextCategory[];
  recurringCharges: ContextRecurring[];
  anomalies: ContextAnomaly[];
  facts: CitableFact[];
}

export interface BriefClaim {
  amountCents: number;
  sourceAggregateId: string;
  label: string;
}

// The raw brief a provider produces, before the pipeline's provenance/tone
// guards run. Mirrors the §4 output schema.
export interface BriefDraft {
  headline: string;
  body: string;
  action: {
    description: string;
    estimatedImpactCents: number | null; // a model *estimate*, labeled as such downstream
    timeframe: string;
  };
  claims: BriefClaim[];
  toneCheck: number; // 0..1 self-rating
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface InsightProvider {
  readonly name: string;
  readonly model: string;
  generateBrief(context: CoachingContext): Promise<{ draft: BriefDraft; usage: TokenUsage | null }>;
}
