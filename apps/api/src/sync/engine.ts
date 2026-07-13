import crypto from 'node:crypto';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { accounts, items, transactions } from '../db/schema.js';
import { decryptToken } from '../lib/crypto.js';
import type { ProviderTransaction, TransactionProvider } from '../providers/types.js';

const TRANSFER_WINDOW_DAYS = 3;
const TRANSFER_HINT = /transfer/i;

/**
 * Cursor-based sync for one item: upserts added/modified pages, soft-removes
 * provider-removed rows, reconciles pending→posted, then runs transfer-pair
 * detection across the owning user's accounts. Returns the item's userId so
 * the caller (the queue layer) can chain an enrichment pass — kept out of
 * this module to avoid a sync/engine.ts <-> queue/index.ts import cycle.
 */
export async function syncItem(
  db: Db,
  provider: TransactionProvider,
  itemId: number,
): Promise<{ userId: number } | null> {
  const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  if (!item || item.status === 'disconnected') return null;

  const accessToken = decryptToken(item.encryptedAccessToken);
  // Refresh and upsert the account set before consuming transaction pages.
  // Providers may add an account to an existing Item after its first link;
  // its transactions must have a local account id during this same sync.
  const providerAccounts = await provider.fetchAccounts(accessToken);
  for (const providerAccount of providerAccounts) {
    await db
      .insert(accounts)
      .values({
        itemId: item.id,
        providerAccountId: providerAccount.providerAccountId,
        name: providerAccount.name,
        officialName: providerAccount.officialName,
        type: providerAccount.type,
        subtype: providerAccount.subtype,
        mask: providerAccount.mask,
        currentBalanceCents: providerAccount.currentBalanceCents,
        isoCurrency: providerAccount.isoCurrency,
      })
      .onConflictDoUpdate({
        target: [accounts.itemId, accounts.providerAccountId],
        set: {
          name: providerAccount.name,
          officialName: providerAccount.officialName,
          type: providerAccount.type,
          subtype: providerAccount.subtype,
          mask: providerAccount.mask,
          currentBalanceCents: providerAccount.currentBalanceCents,
          isoCurrency: providerAccount.isoCurrency,
          updatedAt: new Date(),
        },
      });
  }
  const accountRows = await db.select().from(accounts).where(eq(accounts.itemId, item.id));
  const accountIdByProvider = new Map(accountRows.map((a) => [a.providerAccountId, a.id]));
  const accountIds = accountRows.map((a) => a.id);

  let cursor = item.syncCursor;
  let hasMore = true;
  while (hasMore) {
    const page = await provider.syncTransactions(accessToken, cursor);

    for (const txn of [...page.added, ...page.modified]) {
      const accountId = accountIdByProvider.get(txn.providerAccountId);
      if (!accountId) continue; // account types we don't track (yet)
      await upsertTransaction(db, accountId, txn);
    }

    if (page.removedProviderTxnIds.length > 0 && accountIds.length > 0) {
      await db
        .update(transactions)
        .set({ removedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            inArray(transactions.accountId, accountIds),
            inArray(transactions.providerTxnId, page.removedProviderTxnIds),
            isNull(transactions.removedAt),
          ),
        );
    }

    // Pending→posted reconciliation: a posted txn naming a pending id
    // supersedes that pending row (it stays for history, hidden from views).
    for (const txn of [...page.added, ...page.modified]) {
      if (!txn.pendingTxnId) continue;
      const accountId = accountIdByProvider.get(txn.providerAccountId);
      if (!accountId) continue;
      await db
        .update(transactions)
        .set({ supersededAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(transactions.accountId, accountId),
            eq(transactions.providerTxnId, txn.pendingTxnId),
            isNull(transactions.supersededAt),
          ),
        );
    }

    cursor = page.nextCursor;
    hasMore = page.hasMore;
  }

  await db
    .update(items)
    .set({ syncCursor: cursor, lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(items.id, item.id));

  await detectTransferPairs(db, item.userId);
  return { userId: item.userId };
}

async function upsertTransaction(db: Db, accountId: number, txn: ProviderTransaction): Promise<void> {
  await db
    .insert(transactions)
    .values({
      accountId,
      providerTxnId: txn.providerTxnId,
      amountCents: txn.amountCents,
      isoCurrency: txn.isoCurrency,
      postedDate: txn.postedDate,
      name: txn.name,
      merchantName: txn.merchantName,
      providerCategory: txn.providerCategory,
      pending: txn.pending,
      pendingTxnId: txn.pendingTxnId,
    })
    .onConflictDoUpdate({
      target: [transactions.accountId, transactions.providerTxnId],
      set: {
        amountCents: txn.amountCents,
        postedDate: txn.postedDate,
        name: txn.name,
        merchantName: txn.merchantName,
        providerCategory: txn.providerCategory,
        pending: txn.pending,
        pendingTxnId: txn.pendingTxnId,
        updatedAt: new Date(),
      },
    });
}

/**
 * Own-account transfers must never count as spending. Two legs pair when they
 * have opposite amounts, live in different accounts of the same user, posted
 * within TRANSFER_WINDOW_DAYS, and at least one leg looks like a transfer
 * (provider category or name) — the hint requirement keeps a coincidental
 * spend/refund of the same amount from pairing.
 */
export async function detectTransferPairs(db: Db, userId: number): Promise<void> {
  const candidates = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      amountCents: transactions.amountCents,
      postedDate: transactions.postedDate,
      name: transactions.name,
      providerCategory: transactions.providerCategory,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(items, eq(accounts.itemId, items.id))
    .where(
      and(
        eq(items.userId, userId),
        isNull(transactions.transferPairId),
        isNull(transactions.removedAt),
        isNull(transactions.supersededAt),
        ne(transactions.amountCents, 0),
        sql`${transactions.pending} = false`,
      ),
    );

  const isTransferish = (c: (typeof candidates)[number]) =>
    (c.providerCategory?.toUpperCase().startsWith('TRANSFER') ?? false) || TRANSFER_HINT.test(c.name);

  const used = new Set<number>();
  for (const out of candidates) {
    if (used.has(out.id) || out.amountCents <= 0) continue;
    const match = candidates.find(
      (inn) =>
        !used.has(inn.id) &&
        inn.id !== out.id &&
        inn.accountId !== out.accountId &&
        inn.amountCents === -out.amountCents &&
        Math.abs(Date.parse(inn.postedDate) - Date.parse(out.postedDate)) <=
          TRANSFER_WINDOW_DAYS * 86400000 &&
        (isTransferish(out) || isTransferish(inn)),
    );
    if (!match) continue;
    used.add(out.id);
    used.add(match.id);
    const pairId = crypto.randomUUID();
    await db
      .update(transactions)
      .set({ transferPairId: pairId, updatedAt: new Date() })
      .where(inArray(transactions.id, [out.id, match.id]));
  }
}
