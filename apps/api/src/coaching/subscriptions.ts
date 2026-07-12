import { and, eq, isNull } from 'drizzle-orm';
import type { RecurringCadence, SubscriptionAuditItemView, SubscriptionAuditView } from '@zenfinance/shared';
import type { Db } from '../db/client.js';
import { accounts, items, recurringStreams, transactionEnrichments, transactions } from '../db/schema.js';
import { merchantKey as computeMerchantKey } from '../enrichment/textNormalize.js';

// Cadence → months-per-occurrence multiplier, for normalizing to a monthly cost.
const MONTHLY_MULTIPLIER: Record<string, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  annual: 1 / 12,
};

// Categories whose recurring charges are realistic "should I keep paying for
// this?" candidates. Rent, utilities, insurance, and loans are recurring but
// not cancel-candidates, so they're listed but never flagged.
const CANCEL_CANDIDATE_CATEGORIES = new Set(['SUBSCRIPTIONS_AND_STREAMING', 'FITNESS_AND_GYM']);

const PRICE_CREEP_RATIO = 1.1;

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function cancellationScript(merchant: string, amountCents: number, cadence: string): string {
  return [
    `Subject: Cancel my ${merchant} subscription`,
    '',
    `Hi,`,
    '',
    `I'd like to cancel my ${merchant} subscription (${usd(amountCents)}, billed ${cadence}), effective immediately.`,
    `Please confirm the cancellation in writing and that no further charges will be made to my account.`,
    '',
    `Thank you.`,
  ].join('\n');
}

/**
 * Subscription auditor v1 (§2). A read-time projection over the recurring
 * streams detected in Phase 2 — finds recurring charges, normalizes them to a
 * monthly cost, flags price creep (the latest charge is meaningfully higher
 * than the running average), and drafts a cancellation script for the ones
 * that are realistic cancel candidates (streaming, gym). Rent/utilities/etc.
 * are listed for completeness but never flagged.
 */
export async function auditSubscriptions(db: Db, userId: number): Promise<SubscriptionAuditView> {
  const streams = await db
    .select()
    .from(recurringStreams)
    .where(and(eq(recurringStreams.userId, userId), eq(recurringStreams.active, true)));

  // Dominant category per (account, merchant) from the enriched transactions,
  // so we can tell a Netflix subscription from a rent payment.
  const enriched = await db
    .select({
      accountId: transactions.accountId,
      name: transactions.name,
      merchantName: transactions.merchantName,
      category: transactionEnrichments.category,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .innerJoin(items, eq(accounts.itemId, items.id))
    .innerJoin(
      transactionEnrichments,
      and(eq(transactionEnrichments.transactionId, transactions.id), isNull(transactionEnrichments.supersededAt)),
    )
    .where(eq(items.userId, userId));

  const categoryVotes = new Map<string, Map<string, number>>();
  for (const e of enriched) {
    const key = `${e.accountId}:${computeMerchantKey(e.name, e.merchantName)}`;
    const votes = categoryVotes.get(key) ?? new Map<string, number>();
    votes.set(e.category, (votes.get(e.category) ?? 0) + 1);
    categoryVotes.set(key, votes);
  }
  const dominantCategory = (accountId: number, merchantKey: string): string | null => {
    const votes = categoryVotes.get(`${accountId}:${merchantKey}`);
    if (!votes) return null;
    return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };

  const items_: SubscriptionAuditItemView[] = [];
  let totalMonthlyCents = 0;
  let cancelCandidateMonthlyCents = 0;
  let cancelCandidateCount = 0;

  for (const s of streams) {
    if (s.avgAmountCents <= 0) continue;
    const category = dominantCategory(s.accountId, s.merchantKey);
    const multiplier = MONTHLY_MULTIPLIER[s.cadence] ?? 1;
    const monthlyEquivalentCents = Math.round(s.avgAmountCents * multiplier);
    const isCancelCandidate = category !== null && CANCEL_CANDIDATE_CATEGORIES.has(category);
    const priceCreep = s.lastAmountCents >= Math.round(s.avgAmountCents * PRICE_CREEP_RATIO) && s.lastAmountCents > s.avgAmountCents;

    totalMonthlyCents += monthlyEquivalentCents;
    if (isCancelCandidate) {
      cancelCandidateMonthlyCents += monthlyEquivalentCents;
      cancelCandidateCount++;
    }

    items_.push({
      recurringStreamId: s.id,
      merchantClean: s.merchantClean,
      cadence: s.cadence as RecurringCadence,
      category,
      avgAmountCents: s.avgAmountCents,
      lastAmountCents: s.lastAmountCents,
      monthlyEquivalentCents,
      occurrences: s.occurrences,
      firstSeenDate: s.firstSeenDate,
      lastSeenDate: s.lastSeenDate,
      isCancelCandidate,
      priceCreep,
      priceCreepCents: priceCreep ? s.lastAmountCents - s.avgAmountCents : null,
      cancellationScript: isCancelCandidate ? cancellationScript(s.merchantClean, s.avgAmountCents, s.cadence) : null,
    });
  }

  items_.sort((a, b) => b.monthlyEquivalentCents - a.monthlyEquivalentCents);

  return { items: items_, totalMonthlyCents, cancelCandidateMonthlyCents, cancelCandidateCount };
}
