import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { accounts, items, recurringStreams, transactionEnrichments, transactions } from '../db/schema.js';
import { cleanMerchantName, merchantKey as computeMerchantKey } from '../enrichment/textNormalize.js';

const DAY_MS = 86400000;

interface CadenceRule {
  cadence: 'weekly' | 'biweekly' | 'monthly' | 'annual';
  targetDays: number;
  toleranceDays: number;
}

const CADENCE_RULES: CadenceRule[] = [
  { cadence: 'weekly', targetDays: 7, toleranceDays: 2 },
  { cadence: 'biweekly', targetDays: 14, toleranceDays: 3 },
  { cadence: 'monthly', targetDays: 30, toleranceDays: 5 },
  { cadence: 'annual', targetDays: 365, toleranceDays: 15 },
];

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function classifyCadence(gapDays: number): CadenceRule | null {
  return CADENCE_RULES.find((r) => Math.abs(gapDays - r.targetDays) <= r.toleranceDays) ?? null;
}

function nextExpectedDate(lastSeen: string, cadence: CadenceRule['cadence']): string {
  const days = CADENCE_RULES.find((r) => r.cadence === cadence)!.targetDays;
  return new Date(Date.parse(lastSeen) + days * DAY_MS).toISOString().slice(0, 10);
}

interface Occurrence {
  postedDate: string;
  amountCents: number;
}

/**
 * Rule-based recurring-charge detection (PLAN §4 Stage 3: "rules + LLM
 * assist" — the LLM's per-transaction `isRecurring` guess from enrichment
 * is a weak prior; this pass is the authoritative signal, built from
 * observed repeat occurrences grouped by account + normalized merchant).
 */
export async function detectRecurringStreams(db: Db, userId: number): Promise<void> {
  const rows = await db
    .select({
      transactionId: transactions.id,
      accountId: transactions.accountId,
      name: transactions.name,
      merchantName: transactions.merchantName,
      amountCents: transactions.amountCents,
      postedDate: transactions.postedDate,
      enrichedMerchant: transactionEnrichments.merchantClean,
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
      ),
    )
    .orderBy(desc(transactions.postedDate));

  const groups = new Map<string, { accountId: number; merchantClean: string; occurrences: Occurrence[] }>();
  for (const row of rows) {
    const merchantClean = row.enrichedMerchant ?? cleanMerchantName(row.name, row.merchantName);
    const key = computeMerchantKey(row.name, row.merchantName);
    const groupKey = `${row.accountId}:${key}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { accountId: row.accountId, merchantClean, occurrences: [] });
    }
    groups.get(groupKey)!.occurrences.push({ postedDate: row.postedDate, amountCents: row.amountCents });
  }

  for (const [groupKey, group] of groups) {
    if (group.occurrences.length < 2) continue;
    const merchantKeyPart = groupKey.split(':').slice(1).join(':');
    const sorted = [...group.occurrences].sort((a, b) => Date.parse(a.postedDate) - Date.parse(b.postedDate));

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push((Date.parse(sorted[i]!.postedDate) - Date.parse(sorted[i - 1]!.postedDate)) / DAY_MS);
    }
    const cadenceRule = classifyCadence(median(gaps));
    if (!cadenceRule) continue;

    const amounts = sorted.map((o) => o.amountCents);
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const amountsConsistent = amounts.every(
      (a) => Math.abs(a - avgAmount) <= Math.max(300, avgAmount * 0.15),
    );
    if (!amountsConsistent) continue;

    const firstSeenDate = sorted[0]!.postedDate;
    const lastSeenDate = sorted[sorted.length - 1]!.postedDate;

    await db
      .insert(recurringStreams)
      .values({
        userId,
        accountId: group.accountId,
        merchantKey: merchantKeyPart,
        merchantClean: group.merchantClean,
        cadence: cadenceRule.cadence,
        avgAmountCents: Math.round(avgAmount),
        lastAmountCents: sorted[sorted.length - 1]!.amountCents,
        occurrences: sorted.length,
        firstSeenDate,
        lastSeenDate,
        nextExpectedDate: nextExpectedDate(lastSeenDate, cadenceRule.cadence),
        active: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [recurringStreams.userId, recurringStreams.accountId, recurringStreams.merchantKey],
        set: {
          merchantClean: group.merchantClean,
          cadence: cadenceRule.cadence,
          avgAmountCents: Math.round(avgAmount),
          lastAmountCents: sorted[sorted.length - 1]!.amountCents,
          occurrences: sorted.length,
          firstSeenDate,
          lastSeenDate,
          nextExpectedDate: nextExpectedDate(lastSeenDate, cadenceRule.cadence),
          active: true,
          updatedAt: new Date(),
        },
      });
  }
}
