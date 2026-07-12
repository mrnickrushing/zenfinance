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
  beta: {
    registeredUsers: number;
    linkedUsers: number;
    firstBriefUsers: number;
    actedUsers: number;
    retainedWeek4Users: number;
    activationRate: number;
    actionRate: number;
    week4RetentionRate: number;
  };
  launch: {
    activeUsers7Days: number;
    activeUsers30Days: number;
    premiumUsers: number;
    trialUsers: number;
    paidUsers: number;
    paidConversionRate: number;
    churnedUsers: number;
    churnRate: number;
    mrrCents: number;
    verifiedMoneyWinsAvgCents: number;
    referralRedemptions: number;
    referralCreditsAwarded: number;
  };
  freelancer: {
    enabledUsers: number;
    usersWithIncome: number;
    avgRunwayMonths: number | null;
    avgTargetGapCents: number | null;
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

export interface UserDataExportView {
  generatedAt: string;
  user: {
    id: number;
    email: string;
    appleLinked: boolean;
    createdAt: string;
  };
  items: LinkedItem[];
  transactions: EnrichedTransactionView[];
  goals: GoalView[];
  insights: InsightView[];
  anomalies: AnomalyView[];
  moneyWins: MoneyWinsSummaryView;
  billing: BillingStatusView;
  notificationPreferences: NotificationPreferencesView | null;
}

export interface PrivacyDeletionEventView {
  ok: true;
  deletionEventId: number;
  completedAt: string;
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

// ---------- Billing / monetization (Phase 5) ----------

export const PREMIUM_ENTITLEMENT_ID = 'zen_coach' as const;
export const MONTHLY_PRODUCT_ID = 'com.rushingtechnologies.zenfinance.coach.monthly' as const;
export const ANNUAL_PRODUCT_ID = 'com.rushingtechnologies.zenfinance.coach.annual' as const;

export type BillingStatus = 'free' | 'trialing' | 'active' | 'grace_period' | 'billing_issue' | 'expired' | 'refunded';
export type BillingPlan = 'free' | 'monthly' | 'annual' | 'lifetime' | 'referral' | 'unknown';
export type EntitlementSource = 'revenuecat_webhook' | 'revenuecat_rest' | 'client_restore' | 'manual_test' | 'referral_credit';

export interface BillingEntitlementView {
  entitlementId: string;
  status: BillingStatus;
  plan: BillingPlan;
  productId: string | null;
  store: string | null;
  environment: 'SANDBOX' | 'PRODUCTION' | 'UNKNOWN';
  willRenew: boolean | null;
  expiresAt: string | null;
  latestPurchaseAt: string | null;
  billingIssueAt: string | null;
  cancellationAt: string | null;
  managementUrl: string | null;
  source: EntitlementSource | null;
  updatedAt: string;
}

export interface BillingLimitsView {
  maxLinkedItems: number | null;
  maxActiveGoals: number | null;
  weeklyBriefsOnly: boolean;
  premiumFeatures: boolean;
}

export interface PaywallPackageView {
  identifier: 'monthly' | 'annual';
  productId: string;
  priceLabel: string;
  introTrialDays: number;
  savingsLabel: string | null;
}

export interface PricingExperimentView {
  experimentId: string;
  variant: 'control' | 'money_wins';
  paywallHeadline: string;
  paywallBody: string;
  assignedAt: string;
}

export interface BillingStatusView {
  appUserId: string;
  entitlementId: string;
  isPremium: boolean;
  status: BillingStatus;
  plan: BillingPlan;
  limits: BillingLimitsView;
  entitlement: BillingEntitlementView | null;
  packages: PaywallPackageView[];
  pricingExperiment: PricingExperimentView;
}

export const billingRestoreSchema = z.object({
  appUserId: z.string().trim().min(1).max(200),
  entitlementId: z.string().trim().min(1).max(120).default(PREMIUM_ENTITLEMENT_ID),
  productId: z.string().trim().min(1).max(200).optional(),
  active: z.boolean(),
  expirationDate: z.string().datetime().nullable().optional(),
  latestPurchaseDate: z.string().datetime().nullable().optional(),
  willRenew: z.boolean().nullable().optional(),
  managementUrl: z.string().url().nullable().optional(),
  store: z.string().trim().max(80).optional(),
  environment: z.enum(['SANDBOX', 'PRODUCTION', 'UNKNOWN']).default('UNKNOWN'),
});
export type BillingRestoreInput = z.infer<typeof billingRestoreSchema>;

export interface PaywallEventView {
  ok: true;
}

// ---------- Launch growth loop (Phase 7) ----------

export const referralRedeemSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,16}$/),
});
export type ReferralRedeemInput = z.infer<typeof referralRedeemSchema>;

export interface ReferralCreditView {
  id: number;
  days: number;
  status: 'applied';
  appliedAt: string;
  expiresAt: string;
}

export interface ReferralStatusView {
  code: string;
  shareText: string;
  shareUrl: string;
  referredUsers: number;
  creditsAwarded: number;
  premiumDaysAwarded: number;
  activeCreditExpiresAt: string | null;
  redeemedCode: string | null;
  credits: ReferralCreditView[];
}

export interface ReferralRedeemView {
  ok: true;
  referral: ReferralStatusView;
  billing: BillingStatusView;
}

export interface LaunchContentStatsView {
  generatedAt: string;
  sampleSize: number;
  publishable: boolean;
  minimumSampleSize: number;
  metrics: {
    linkedUsers: number;
    premiumUsers: number;
    avgRecurringStreamsPerLinkedUser: number;
    avgRecurringMonthlyCentsPerLinkedUser: number;
    avgVerifiedMoneyWinsCentsPerUser: number;
    referralRedemptions: number;
  };
}

// ---------- Freelancer Mode (Phase 8) ----------

export const freelancerProfileUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  targetMonthlyIncomeCents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  taxSetAsideBps: z.number().int().min(0).max(5000).optional(),
  runwayTargetMonths: z.number().int().min(1).max(24).optional(),
});
export type FreelancerProfileUpdateInput = z.infer<typeof freelancerProfileUpdateSchema>;

export interface FreelancerProfileView {
  enabled: boolean;
  targetMonthlyIncomeCents: number | null;
  taxSetAsideBps: number;
  runwayTargetMonths: number;
  createdAt: string;
  updatedAt: string;
}

export interface FreelancerIncomeMonthView {
  month: string;
  incomeCents: number;
  essentialSpendCents: number;
  netCents: number;
}

export interface FreelancerRecommendationView {
  kind: 'tax_set_aside' | 'runway' | 'income_target' | 'income_volatility' | 'link_accounts';
  severity: 'info' | 'warning' | 'urgent';
  title: string;
  body: string;
}

export interface FreelancerSummaryView {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  profile: FreelancerProfileView;
  months: FreelancerIncomeMonthView[];
  avgMonthlyIncomeCents: number;
  minMonthlyIncomeCents: number;
  maxMonthlyIncomeCents: number;
  incomeVolatilityRatio: number;
  incomeConfidence: 'none' | 'low' | 'medium' | 'high';
  essentialMonthlySpendCents: number;
  cashBalanceCents: number | null;
  runwayMonths: number | null;
  runwayTargetGapCents: number | null;
  targetMonthlyIncomeGapCents: number | null;
  estimatedTaxSetAsideMonthlyCents: number;
  estimatedTaxSetAsideRateBps: number;
  nextSlowMonthBufferCents: number;
  recommendations: FreelancerRecommendationView[];
}

// ---------- Mobile app product surface (Phase 4 + Phase 5) ----------

export interface MobileHomeSummaryView {
  billing: BillingStatusView;
  items: LinkedItem[];
  transactionCount: number;
  firstLook: InsightView | null;
  weeklyBrief: InsightView | null;
  goals: GoalView[];
  subscriptionAudit: SubscriptionAuditView;
  moneyWins: MoneyWinsSummaryView;
  openAnomalies: AnomalyView[];
  recentTransactions: EnrichedTransactionView[];
}

export const chatQuestionSchema = z.object({
  question: z.string().trim().min(3).max(500),
});
export type ChatQuestionInput = z.infer<typeof chatQuestionSchema>;

export interface ChatFactView {
  label: string;
  amountCents: number | null;
  source: 'transaction_query' | 'feature_rollup' | 'goal' | 'subscription_audit' | 'money_wins';
}

export interface ChatAnswerView {
  id: string;
  answer: string;
  facts: ChatFactView[];
  actions: string[];
  createdAt: string;
}

export const whatIfSchema = z
  .object({
    goalId: z.number().int().positive().optional(),
    monthlySpendReductionCents: z.number().int().min(0).max(100_000_00).default(0),
    oneTimeSavingsCents: z.number().int().min(0).max(100_000_00).default(0),
    monthlyIncomeChangeCents: z.number().int().min(-100_000_00).max(100_000_00).default(0),
  })
  .refine(
    (v) => v.monthlySpendReductionCents > 0 || v.oneTimeSavingsCents > 0 || v.monthlyIncomeChangeCents !== 0,
    'At least one what-if input must be non-zero',
  );
export type WhatIfInput = z.infer<typeof whatIfSchema>;

export interface WhatIfGoalProjectionView {
  goalId: number;
  name: string;
  currentProjectedCompletionDate: string | null;
  simulatedProjectedCompletionDate: string | null;
  weeksFaster: number | null;
  remainingAmountCents: number;
}

export interface WhatIfResultView {
  weeklyNetChangeCents: number;
  oneTimeSavingsCents: number;
  monthlySpendReductionCents: number;
  monthlyIncomeChangeCents: number;
  projections: WhatIfGoalProjectionView[];
  narration: string;
}

export const pushTokenSchema = z.object({
  token: z.string().trim().min(10).max(512),
  platform: z.enum(['ios', 'android', 'web']).default('ios'),
});
export type PushTokenInput = z.infer<typeof pushTokenSchema>;

export const notificationPreferencesSchema = z.object({
  weeklyBrief: z.boolean(),
  anomalies: z.boolean(),
  goalPacing: z.boolean(),
  marketing: z.boolean(),
});
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

export interface NotificationPreferencesView extends NotificationPreferencesInput {
  pushEnabled: boolean;
  updatedAt: string;
}

export const appEventSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_:-]+$/i),
  properties: z.record(z.unknown()).default({}),
});
export type AppEventInput = z.infer<typeof appEventSchema>;
