import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const supportStatusEnum = pgEnum('support_status', ['open', 'resolved']);

export const waitlistSignups = pgTable(
  'waitlist_signups',
  {
    id: serial('id').primaryKey(),
    email: text('email').notNull().unique(),
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('waitlist_created_at_idx').on(t.createdAt)],
);

export const supportRequests = pgTable(
  'support_requests',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    message: text('message').notNull(),
    status: supportStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('support_status_idx').on(t.status), index('support_created_at_idx').on(t.createdAt)],
);

// Refresh tokens for the admin console session. Tokens are stored only as
// SHA-256 hashes; `familyId` groups a rotation chain so that reuse of an
// already-rotated token revokes the whole family (theft signal).
export const adminRefreshTokens = pgTable(
  'admin_refresh_tokens',
  {
    id: serial('id').primaryKey(),
    familyId: text('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedById: integer('replaced_by_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('admin_refresh_family_idx').on(t.familyId)],
);

// ---------- Phase 1: users, items, accounts, transactions ----------

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'), // null for Apple-only accounts
    appleSub: text('apple_sub').unique(), // Apple Sign-In stable subject
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

// Same rotation-family model as admin_refresh_tokens, but per user and
// presented in the JSON body (the iOS client keeps it in the Keychain).
export const userRefreshTokens = pgTable(
  'user_refresh_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: text('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedById: integer('replaced_by_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('user_refresh_family_idx').on(t.familyId),
    index('user_refresh_user_idx').on(t.userId),
  ],
);

export const itemStatusEnum = pgEnum('item_status', ['active', 'login_required', 'disconnected']);

// A provider connection (Plaid "Item"). The provider access token is stored
// AES-256-GCM encrypted with TOKEN_ENC_KEY — never plaintext, never client-side.
export const items = pgTable(
  'items',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'plaid' | 'mock' (| 'teller' later)
    providerItemId: text('provider_item_id').notNull().unique(),
    encryptedAccessToken: text('encrypted_access_token').notNull(),
    institutionName: text('institution_name'),
    status: itemStatusEnum('status').notNull().default('active'),
    syncCursor: text('sync_cursor'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('items_user_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: serial('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    providerAccountId: text('provider_account_id').notNull(),
    name: text('name').notNull(),
    officialName: text('official_name'),
    type: text('type').notNull(), // depository | credit | loan | ...
    subtype: text('subtype'),
    mask: text('mask'),
    currentBalanceCents: bigint('current_balance_cents', { mode: 'number' }),
    isoCurrency: text('iso_currency').notNull().default('USD'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('accounts_item_provider_idx').on(t.itemId, t.providerAccountId),
    index('accounts_item_idx').on(t.itemId),
  ],
);

// Append-friendly: provider-removed rows get removedAt set instead of being
// deleted, and pending rows superseded by a posted txn keep their history.
export const transactions = pgTable(
  'transactions',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    providerTxnId: text('provider_txn_id').notNull(),
    // Positive = money out (spend), negative = money in — Plaid's convention.
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    isoCurrency: text('iso_currency').notNull().default('USD'),
    postedDate: date('posted_date').notNull(),
    name: text('name').notNull(),
    merchantName: text('merchant_name'),
    providerCategory: text('provider_category'), // provider's own category, pre-AI
    pending: boolean('pending').notNull().default(false),
    pendingTxnId: text('pending_txn_id'), // provider id of the pending row this posted txn supersedes
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    transferPairId: text('transfer_pair_id'), // shared id linking both legs of an own-account transfer
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('txn_account_provider_idx').on(t.accountId, t.providerTxnId),
    index('txn_account_date_idx').on(t.accountId, t.postedDate),
    index('txn_transfer_pair_idx').on(t.transferPairId),
  ],
);

// ---------- Phase 2: AI enrichment ----------

export const enrichmentSourceEnum = pgEnum('enrichment_source', ['llm', 'fallback', 'user_correction']);

// Enrichment versioning, mirroring the append-friendly pattern used for
// pending→posted reconciliation: re-categorizing a transaction never
// destroys history, it supersedes the previous row. Exactly one row per
// transaction has supersededAt IS NULL (the "current" enrichment).
export const transactionEnrichments = pgTable(
  'transaction_enrichments',
  {
    id: serial('id').primaryKey(),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    merchantClean: text('merchant_clean'),
    isRecurring: boolean('is_recurring').notNull().default(false),
    isDiscretionary: boolean('is_discretionary').notNull().default(false),
    confidence: real('confidence').notNull(),
    source: enrichmentSourceEnum('source').notNull(),
    model: text('model'), // e.g. 'claude-haiku-4-5' | 'mock-rules-v1' | null for user_correction
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('txn_enrich_txn_idx').on(t.transactionId),
    index('txn_enrich_current_idx').on(t.transactionId, t.supersededAt),
  ],
);

// User corrections double as the audit trail and the per-user few-shot store
// (§4: "user corrections are stored and injected as few-shot examples into
// that user's future enrichment calls").
export const categoryCorrections = pgTable(
  'category_corrections',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    merchantKey: text('merchant_key').notNull(), // normalized merchant/name used for few-shot matching
    originalCategory: text('original_category'),
    correctedCategory: text('corrected_category').notNull(),
    correctedIsDiscretionary: boolean('corrected_is_discretionary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('corrections_user_idx').on(t.userId),
    index('corrections_user_merchant_idx').on(t.userId, t.merchantKey),
  ],
);

export const recurringCadenceEnum = pgEnum('recurring_cadence', [
  'weekly',
  'biweekly',
  'monthly',
  'annual',
]);

// Rule-detected recurring charges (subscriptions, rent, payroll, etc.), keyed
// by (user, account, normalized merchant) so a re-detection run upserts in
// place instead of duplicating.
export const recurringStreams = pgTable(
  'recurring_streams',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    merchantKey: text('merchant_key').notNull(),
    merchantClean: text('merchant_clean').notNull(),
    cadence: recurringCadenceEnum('cadence').notNull(),
    avgAmountCents: bigint('avg_amount_cents', { mode: 'number' }).notNull(),
    lastAmountCents: bigint('last_amount_cents', { mode: 'number' }).notNull(),
    occurrences: integer('occurrences').notNull().default(2),
    firstSeenDate: date('first_seen_date').notNull(),
    lastSeenDate: date('last_seen_date').notNull(),
    nextExpectedDate: date('next_expected_date'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('recurring_user_account_merchant_idx').on(t.userId, t.accountId, t.merchantKey),
    index('recurring_user_idx').on(t.userId),
  ],
);

// Nightly per-user feature-store rollups (§4 Stage 3). `aggregateId` is
// stable (deterministic hash of user+week+metric+category) so insight
// generation can cite it and idempotent recomputation just upserts.
// `category` defaults to '_total' (not null) for non-category-split metrics
// so the unique index behaves correctly — Postgres treats NULL as distinct
// on every row, which would silently allow duplicate "total" rows.
export const featureRollups = pgTable(
  'feature_rollups',
  {
    id: serial('id').primaryKey(),
    aggregateId: text('aggregate_id').notNull().unique(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    weekStart: date('week_start').notNull(), // Monday of the ISO week, UTC
    metric: text('metric').notNull(), // 'category_spend' | 'total_spend' | 'discretionary_ratio' | 'recurring_load' | 'income_total' | 'volatility'
    category: text('category').notNull().default('_total'),
    valueCents: bigint('value_cents', { mode: 'number' }),
    valueRatio: real('value_ratio'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rollup_user_week_metric_category_idx').on(
      t.userId,
      t.weekStart,
      t.metric,
      t.category,
    ),
    index('rollup_user_idx').on(t.userId),
  ],
);

// Cost metering for the AI layer (§10 KPI: blended cost/user/month). One row
// per provider call; `estimatedCostUsd` is computed from published per-token
// pricing at call time so a later price change doesn't retroactively distort
// historical spend.
export const aiUsageEvents = pgTable(
  'ai_usage_events',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(), // 'enrichment' | 'brief' (future: 'chat')
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    estimatedCostUsd: real('estimated_cost_usd').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_usage_user_idx').on(t.userId),
    index('ai_usage_user_created_idx').on(t.userId, t.createdAt),
  ],
);

// ---------- Phase 3: coaching engine ----------

export const goalStatusEnum = pgEnum('goal_status', ['active', 'achieved', 'archived']);

// User savings goals (PLAN §2 free tier: 1 active goal; premium: multiple with
// priorities). `currentAmountCents` is what the user has set aside toward the
// goal; pacing math (weekly target, projected completion) is derived
// deterministically in code (coaching/goals.ts), never stored, so it always
// reflects the latest target/progress.
export const goals = pgTable(
  'goals',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetAmountCents: bigint('target_amount_cents', { mode: 'number' }).notNull(),
    currentAmountCents: bigint('current_amount_cents', { mode: 'number' }).notNull().default(0),
    targetDate: date('target_date'), // null = open-ended (no deadline)
    priority: integer('priority').notNull().default(1), // lower = higher priority
    status: goalStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('goals_user_idx').on(t.userId), index('goals_user_status_idx').on(t.userId, t.status)],
);

export const insightKindEnum = pgEnum('insight_kind', ['first_look', 'weekly_brief']);
export const insightSourceEnum = pgEnum('insight_source', ['llm', 'template']);
export const feedbackRatingEnum = pgEnum('feedback_rating', ['up', 'down']);

// Generated coaching artifacts (§4 Stage 4). Every insight names a dollar
// amount and an action. `claims` is the provenance-checked list of verified
// dollar figures, each citing a `source_aggregate_id` present in the inputs;
// `actionEstimatedImpactCents` is a *model estimate*, labeled as such in the
// UI, never a verified figure. `source` distinguishes a real model brief from
// the deterministic template fallback. Feedback columns hold the thumbs
// rating and the next-week "did you do it?" follow-through check.
export const insights = pgTable(
  'insights',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: insightKindEnum('kind').notNull(),
    weekStart: date('week_start'), // the ISO week the brief covers; null for first_look
    headline: text('headline').notNull(),
    body: text('body').notNull(),
    actionDescription: text('action_description').notNull(),
    actionEstimatedImpactCents: bigint('action_estimated_impact_cents', { mode: 'number' }),
    actionTimeframe: text('action_timeframe').notNull(),
    // [{ amountCents, sourceAggregateId, label }] — verified figures only.
    claims: jsonb('claims').notNull().default('[]'),
    toneCheck: real('tone_check').notNull(),
    source: insightSourceEnum('source').notNull(),
    model: text('model'), // e.g. 'claude-sonnet-5' | null for template
    feedbackRating: feedbackRatingEnum('feedback_rating'),
    feedbackFollowedThrough: boolean('feedback_followed_through'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('insights_user_idx').on(t.userId),
    index('insights_user_created_idx').on(t.userId, t.createdAt),
    uniqueIndex('insights_user_kind_week_idx').on(t.userId, t.kind, t.weekStart),
  ],
);

export const anomalyKindEnum = pgEnum('anomaly_kind', [
  'duplicate_charge',
  'unusual_amount',
  'fee',
  'new_recurring',
]);
export const anomalyStatusEnum = pgEnum('anomaly_status', ['open', 'acknowledged', 'dismissed']);

// Rule-detected anomalies (§2 free tier: anomaly alerts build trust). Keyed by
// a deterministic `dedupeKey` so re-running detection over the same
// transactions never produces duplicate alerts.
export const anomalies = pgTable(
  'anomalies',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    transactionId: integer('transaction_id').references(() => transactions.id, { onDelete: 'cascade' }),
    kind: anomalyKindEnum('kind').notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    status: anomalyStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('anomalies_user_dedupe_idx').on(t.userId, t.dedupeKey),
    index('anomalies_user_status_idx').on(t.userId, t.status),
  ],
);

export const moneyWinStatusEnum = pgEnum('money_win_status', ['estimated', 'verified']);
export const moneyWinKindEnum = pgEnum('money_win_kind', [
  'subscription_canceled',
  'fee_refund',
  'anomaly_caught',
  'spend_reduction',
]);

// The Money Wins ledger (§2: "the single most important retention/renewal
// screen"). Each win is `estimated` until the §4 Stage 5 verification bar is
// met: for a canceled subscription, the expected charge must be absent for
// `verifyCyclesRequired` consecutive billing cycles (tracked in
// `cyclesObserved`) OR the user confirms the cancellation (`userConfirmed`).
// `sourceRecurringStreamId` + `expectedChargeCents` let the verifier check the
// charge's continued absence on later syncs.
export const moneyWins = pgTable(
  'money_wins',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    insightId: integer('insight_id').references(() => insights.id, { onDelete: 'set null' }),
    kind: moneyWinKindEnum('kind').notNull(),
    description: text('description').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    status: moneyWinStatusEnum('status').notNull().default('estimated'),
    dedupeKey: text('dedupe_key').notNull(),
    sourceRecurringStreamId: integer('source_recurring_stream_id').references(() => recurringStreams.id, {
      onDelete: 'set null',
    }),
    expectedChargeCents: bigint('expected_charge_cents', { mode: 'number' }),
    cyclesObserved: integer('cycles_observed').notNull().default(0),
    verifyCyclesRequired: integer('verify_cycles_required').notNull().default(2),
    userConfirmed: boolean('user_confirmed').notNull().default(false),
    lastCheckedDate: date('last_checked_date'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('money_wins_user_dedupe_idx').on(t.userId, t.dedupeKey),
    index('money_wins_user_idx').on(t.userId),
    index('money_wins_user_status_idx').on(t.userId, t.status),
  ],
);

// ---------- Phase 4: mobile product surface ----------

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    facts: jsonb('facts').notNull().default('[]'),
    actions: jsonb('actions').notNull().default('[]'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chat_messages_user_created_idx').on(t.userId, t.createdAt)],
);

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform').notNull().default('ios'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('push_tokens_token_idx').on(t.token), index('push_tokens_user_idx').on(t.userId)],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: integer('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    weeklyBrief: boolean('weekly_brief').notNull().default(true),
    anomalies: boolean('anomalies').notNull().default(true),
    goalPacing: boolean('goal_pacing').notNull().default(true),
    marketing: boolean('marketing').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const appEvents = pgTable(
  'app_events',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    properties: jsonb('properties').notNull().default('{}'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('app_events_user_created_idx').on(t.userId, t.createdAt), index('app_events_name_idx').on(t.name)],
);
