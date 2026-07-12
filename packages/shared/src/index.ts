import { z } from 'zod';

// ---------- Waitlist ----------

export const waitlistSignupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  source: z.string().trim().max(100).optional(),
});
export type WaitlistSignupInput = z.infer<typeof waitlistSignupSchema>;

// ---------- Support ----------

export const supportRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  message: z.string().trim().min(10).max(5000),
});
export type SupportRequestInput = z.infer<typeof supportRequestSchema>;

export const supportStatusSchema = z.enum(['open', 'resolved']);
export type SupportStatus = z.infer<typeof supportStatusSchema>;

// ---------- Admin ----------

export const adminLoginSchema = z.object({
  secret: z.string().min(1).max(512),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export const supportUpdateSchema = z.object({
  status: supportStatusSchema,
});
export type SupportUpdateInput = z.infer<typeof supportUpdateSchema>;

// ---------- API response shapes ----------

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface WaitlistEntry {
  id: number;
  email: string;
  source: string | null;
  createdAt: string;
}

export interface SupportTicket {
  id: number;
  name: string;
  email: string;
  message: string;
  status: SupportStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AdminMetrics {
  waitlist: {
    total: number;
    last7Days: number;
    last30Days: number;
    dailySignups: Array<{ date: string; count: number }>;
  };
  support: {
    total: number;
    open: number;
    resolved: number;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------- User auth (Phase 1) ----------

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(200),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(1024),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const appleAuthSchema = z.object({
  identityToken: z.string().min(1).max(8192),
  rawNonce: z.string().min(1).max(512),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
});
export type AppleAuthInput = z.infer<typeof appleAuthSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// ---------- Linking (Phase 1) ----------

export const linkExchangeSchema = z.object({
  publicToken: z.string().min(1).max(2048),
  institutionName: z.string().trim().max(200).optional(),
});
export type LinkExchangeInput = z.infer<typeof linkExchangeSchema>;

export interface LinkedAccount {
  id: number;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalanceCents: number | null;
  isoCurrency: string;
}

export interface LinkedItem {
  id: number;
  provider: string;
  institutionName: string | null;
  status: 'active' | 'login_required' | 'disconnected';
  lastSyncedAt: string | null;
  accounts: LinkedAccount[];
}

export interface TransactionView {
  id: number;
  accountId: number;
  amountCents: number;
  isoCurrency: string;
  postedDate: string;
  name: string;
  merchantName: string | null;
  pending: boolean;
  transferPairId: string | null;
}

// ---------- AI enrichment (Phase 2) ----------

export type EnrichmentSource = 'llm' | 'fallback' | 'user_correction';

export interface EnrichedTransactionView extends TransactionView {
  category: string | null;
  merchantClean: string | null;
  isDiscretionary: boolean | null;
  isRecurring: boolean | null;
  confidence: number | null;
  enrichmentSource: EnrichmentSource | null;
}

// The API validates `category` against the canonical taxonomy
// (apps/api/src/enrichment/categories.ts) — kept out of the shared package
// since it's server-internal (default discretionary leans, fallback
// mappings). This schema only enforces the request shape.
export const categoryCorrectionSchema = z.object({
  category: z.string().trim().min(1).max(64),
  isDiscretionary: z.boolean().optional(),
});
export type CategoryCorrectionInput = z.infer<typeof categoryCorrectionSchema>;

export type RecurringCadence = 'weekly' | 'biweekly' | 'monthly' | 'annual';

export interface RecurringStreamView {
  id: number;
  accountId: number;
  merchantClean: string;
  cadence: RecurringCadence;
  avgAmountCents: number;
  lastAmountCents: number;
  occurrences: number;
  firstSeenDate: string;
  lastSeenDate: string;
  nextExpectedDate: string | null;
  active: boolean;
}

export interface FeatureRollupView {
  weekStart: string;
  metric: string;
  category: string;
  valueCents: number | null;
  valueRatio: number | null;
}

// ---------- Coaching engine (Phase 3) ----------

export type InsightKind = 'first_look' | 'weekly_brief';
export type InsightSource = 'llm' | 'template';

export interface InsightClaim {
  amountCents: number;
  sourceAggregateId: string;
  label: string;
}

export interface InsightView {
  id: number;
  kind: InsightKind;
  weekStart: string | null;
  headline: string;
  body: string;
  action: {
    description: string;
    // A model *estimate*, labeled as such in the UI — never a verified figure.
    estimatedImpactCents: number | null;
    timeframe: string;
  };
  claims: InsightClaim[];
  toneCheck: number;
  source: InsightSource;
  feedbackRating: 'up' | 'down' | null;
  feedbackFollowedThrough: boolean | null;
  createdAt: string;
}

export const insightFeedbackSchema = z.object({
  rating: z.enum(['up', 'down']).optional(),
  followedThrough: z.boolean().optional(),
});
export type InsightFeedbackInput = z.infer<typeof insightFeedbackSchema>;

export type GoalStatus = 'active' | 'achieved' | 'archived';
export type PacingStatus = 'on_track' | 'behind' | 'ahead' | 'no_deadline' | 'unknown';

export interface GoalView {
  id: number;
  name: string;
  targetAmountCents: number;
  currentAmountCents: number;
  targetDate: string | null;
  priority: number;
  status: GoalStatus;
  pacing: {
    remainingAmountCents: number;
    progressRatio: number;
    weeksRemaining: number | null;
    weeklyTargetCents: number | null;
    projectedCompletionDate: string | null;
    pacingStatus: PacingStatus;
  };
}

export const createGoalSchema = z.object({
  name: z.string().trim().min(1).max(120),
  targetAmountCents: z.number().int().positive().max(1_000_000_00),
  currentAmountCents: z.number().int().min(0).max(1_000_000_00).optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'targetDate must be YYYY-MM-DD')
    .optional(),
  priority: z.number().int().min(1).max(100).optional(),
});
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

export const updateGoalSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  targetAmountCents: z.number().int().positive().max(1_000_000_00).optional(),
  currentAmountCents: z.number().int().min(0).max(1_000_000_00).optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'targetDate must be YYYY-MM-DD')
    .nullable()
    .optional(),
  priority: z.number().int().min(1).max(100).optional(),
  status: z.enum(['active', 'achieved', 'archived']).optional(),
});
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;

export type AnomalyKind = 'duplicate_charge' | 'unusual_amount' | 'fee' | 'new_recurring';
export type AnomalyStatus = 'open' | 'acknowledged' | 'dismissed';

export interface AnomalyView {
  id: number;
  kind: AnomalyKind;
  title: string;
  detail: string;
  amountCents: number;
  status: AnomalyStatus;
  createdAt: string;
}

export const anomalyUpdateSchema = z.object({
  status: z.enum(['acknowledged', 'dismissed']),
});
export type AnomalyUpdateInput = z.infer<typeof anomalyUpdateSchema>;

export interface SubscriptionAuditItemView {
  recurringStreamId: number;
  merchantClean: string;
  cadence: RecurringCadence;
  category: string | null;
  avgAmountCents: number;
  lastAmountCents: number;
  monthlyEquivalentCents: number;
  occurrences: number;
  firstSeenDate: string;
  lastSeenDate: string;
  isCancelCandidate: boolean;
  priceCreep: boolean;
  priceCreepCents: number | null;
  cancellationScript: string | null;
}

export interface SubscriptionAuditView {
  items: SubscriptionAuditItemView[];
  totalMonthlyCents: number;
  cancelCandidateMonthlyCents: number;
  cancelCandidateCount: number;
}

export type MoneyWinStatus = 'estimated' | 'verified';
export type MoneyWinKind = 'subscription_canceled' | 'fee_refund' | 'anomaly_caught' | 'spend_reduction';

export interface MoneyWinView {
  id: number;
  kind: MoneyWinKind;
  description: string;
  amountCents: number;
  status: MoneyWinStatus;
  createdAt: string;
}

export interface MoneyWinsSummaryView {
  verifiedTotalCents: number;
  estimatedTotalCents: number;
  wins: MoneyWinView[];
}

export const cancelSubscriptionSchema = z.object({
  recurringStreamId: z.number().int().positive(),
});
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
