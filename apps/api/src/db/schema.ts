import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
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
