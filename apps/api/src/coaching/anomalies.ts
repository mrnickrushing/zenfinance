import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { accounts, anomalies, items, recurringStreams, transactionEnrichments, transactions } from '../db/schema.js';
import { merchantKey as computeMerchantKey } from '../enrichment/textNormalize.js';

const DAY_MS = 86400000;
const DUPLICATE_WINDOW_DAYS = 3;
const RECENT_DAYS = 35;
const UNUSUAL_LOOKBACK_DAYS = 120;
const UNUSUAL_RECENT_DAYS = 10;
const UNUSUAL_MULTIPLE = 3;
const UNUSUAL_FLOOR_CENTS = 5000; // don't flag small charges even if 3x median
const NEW_RECURRING_DAYS = 7;

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function daysAgoDate(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

interface AnomalyInsert {
  transactionId: number | null;
  kind: 'duplicate_charge' | 'unusual_amount' | 'fee' | 'new_recurring';
  title: string;
  detail: string;
  amountCents: number;
  dedupeKey: string;
}

/**
 * Rule-based anomaly detection (§2: anomaly alerts build trust; §4 Stage 4:
 * notable events feed the brief). Detects duplicate charges, unusually large
 * charges vs a merchant's own history, fees, and newly-detected recurring
 * charges. Every anomaly carries a deterministic `dedupeKey` so re-running is
 * idempotent — `onConflictDoNothing` skips ones already recorded.
 */
export async function detectAnomalies(db: Db, userId: number): Promise<void> {
  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      name: transactions.name,
      merchantName: transactions.merchantName,
      amountCents: transactions.amountCents,
      postedDate: transactions.postedDate,
      category: transactionEnrichments.category,
      merchantClean: transactionEnrichments.merchantClean,
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
        gte(transactions.postedDate, daysAgoDate(UNUSUAL_LOOKBACK_DAYS)),
      ),
    )
    .orderBy(desc(transactions.postedDate));

  const found: AnomalyInsert[] = [];
  const recentCutoff = daysAgoDate(RECENT_DAYS);
  const unusualRecentCutoff = daysAgoDate(UNUSUAL_RECENT_DAYS);

  // Group by (account, normalized merchant) for duplicate + unusual detection.
  const byMerchant = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.amountCents <= 0) continue; // spend only (positive = money out)
    const key = `${r.accountId}:${computeMerchantKey(r.name, r.merchantName)}`;
    const list = byMerchant.get(key) ?? [];
    list.push(r);
    byMerchant.set(key, list);
  }

  for (const [, list] of byMerchant) {
    // --- duplicate charges: same amount, same merchant/account, within window ---
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.amountCents !== b.amountCents) continue;
        if (Math.abs(Date.parse(a.postedDate) - Date.parse(b.postedDate)) > DUPLICATE_WINDOW_DAYS * DAY_MS) continue;
        const later = Date.parse(a.postedDate) >= Date.parse(b.postedDate) ? a : b;
        if (later.postedDate < recentCutoff) continue; // only surface recent duplicates
        const merchant = later.merchantClean ?? later.name;
        found.push({
          transactionId: later.id,
          kind: 'duplicate_charge',
          title: `Possible duplicate charge at ${merchant}`,
          detail: `Two ${usd(later.amountCents)} charges from ${merchant} within ${DUPLICATE_WINDOW_DAYS} days.`,
          amountCents: later.amountCents,
          dedupeKey: `dup:${later.accountId}:${computeMerchantKey(later.name, later.merchantName)}:${later.amountCents}:${later.postedDate}`,
        });
      }
    }

    // --- unusual amount: a recent charge far above this merchant's own median ---
    if (list.length >= 4) {
      const med = median(list.map((r) => r.amountCents));
      for (const r of list) {
        if (r.postedDate < unusualRecentCutoff) continue;
        if (r.amountCents < UNUSUAL_FLOOR_CENTS) continue;
        if (med > 0 && r.amountCents >= med * UNUSUAL_MULTIPLE) {
          const merchant = r.merchantClean ?? r.name;
          found.push({
            transactionId: r.id,
            kind: 'unusual_amount',
            title: `Unusually large charge at ${merchant}`,
            detail: `${usd(r.amountCents)} is well above your usual ${usd(Math.round(med))} at ${merchant}.`,
            amountCents: r.amountCents,
            dedupeKey: `unusual:${r.id}`,
          });
        }
      }
    }
  }

  // --- fees: any fee-categorized charge in the recent window ---
  for (const r of rows) {
    if (r.category !== 'FEES_AND_CHARGES') continue;
    if (r.postedDate < recentCutoff) continue;
    if (r.amountCents <= 0) continue;
    const merchant = r.merchantClean ?? r.name;
    found.push({
      transactionId: r.id,
      kind: 'fee',
      title: `${usd(r.amountCents)} fee`,
      detail: `A ${usd(r.amountCents)} fee from ${merchant} — worth a look; some are avoidable.`,
      amountCents: r.amountCents,
      dedupeKey: `fee:${r.id}`,
    });
  }

  // --- new recurring charges: streams first detected in the last week ---
  const newStreams = await db
    .select()
    .from(recurringStreams)
    .where(
      and(
        eq(recurringStreams.userId, userId),
        eq(recurringStreams.active, true),
        gte(recurringStreams.createdAt, new Date(Date.now() - NEW_RECURRING_DAYS * DAY_MS)),
      ),
    );
  for (const s of newStreams) {
    found.push({
      transactionId: null,
      kind: 'new_recurring',
      title: `New recurring charge: ${s.merchantClean}`,
      detail: `Looks like a ${s.cadence} charge of ${usd(s.avgAmountCents)} from ${s.merchantClean}.`,
      amountCents: s.avgAmountCents,
      dedupeKey: `newrec:${s.id}`,
    });
  }

  for (const a of found) {
    await db
      .insert(anomalies)
      .values({ userId, ...a })
      .onConflictDoNothing({ target: [anomalies.userId, anomalies.dedupeKey] });
  }
}
