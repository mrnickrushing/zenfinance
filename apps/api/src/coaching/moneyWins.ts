import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type { MoneyWinsSummaryView } from '@zenfinance/shared';
import type { Db } from '../db/client.js';
import {
  accounts,
  anomalies,
  featureRollups,
  items,
  moneyWins,
  recurringStreams,
  transactions,
} from '../db/schema.js';
import { defaultDiscretionaryFor, labelFor } from '../enrichment/categories.js';
import { merchantKey as computeMerchantKey } from '../enrichment/textNormalize.js';

const DAY_MS = 86400000;
const CADENCE_DAYS: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 31, annual: 366 };
const SPEND_REDUCTION_MIN_CENTS = 2000; // only surface a drop of >= $20
const SYNC_STALE_DAYS = 40; // don't advance verification if the item hasn't synced recently

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Estimated spend-reduction wins: for a completed week, any discretionary
 * category that dropped meaningfully vs the prior week becomes an *estimated*
 * win (§4 Stage 5 — a coach-attributed reduction is never auto-verified,
 * since we can't prove causation). Idempotent per (user, category, week).
 */
export async function recordSpendReductionWins(db: Db, userId: number, weekStart: string): Promise<void> {
  const priorWeekStart = isoDate(new Date(Date.parse(weekStart) - 7 * DAY_MS));
  const rows = await db
    .select({
      weekStart: featureRollups.weekStart,
      category: featureRollups.category,
      valueCents: featureRollups.valueCents,
    })
    .from(featureRollups)
    .where(
      and(
        eq(featureRollups.userId, userId),
        eq(featureRollups.metric, 'category_spend'),
        sql`${featureRollups.weekStart} in (${weekStart}, ${priorWeekStart})`,
      ),
    );

  const thisWeek = new Map<string, number>();
  const prior = new Map<string, number>();
  for (const r of rows) {
    (r.weekStart === weekStart ? thisWeek : prior).set(r.category, r.valueCents ?? 0);
  }

  for (const [category, priorCents] of prior) {
    if (!defaultDiscretionaryFor(category)) continue;
    const nowCents = thisWeek.get(category) ?? 0;
    const drop = priorCents - nowCents;
    if (drop < SPEND_REDUCTION_MIN_CENTS) continue;
    await db
      .insert(moneyWins)
      .values({
        userId,
        kind: 'spend_reduction',
        description: `You spent $${(drop / 100).toFixed(2)} less on ${labelFor(category)} than the week before.`,
        amountCents: drop,
        status: 'estimated',
        dedupeKey: `spendreduce:${category}:${weekStart}`,
      })
      .onConflictDoNothing({ target: [moneyWins.userId, moneyWins.dedupeKey] });
  }
}

/**
 * Record an *estimated* subscription-cancellation win. Called when a user
 * marks a recurring charge as canceled. The win stays estimated until the
 * expected charge is confirmed absent for `verifyCyclesRequired` cycles
 * (verifyMoneyWins) or the user confirms it (confirmMoneyWin). `amountCents`
 * accrues the actually-avoided charges as cycles pass — it never claims a
 * saving that hasn't been realized.
 */
export async function recordSubscriptionCancellation(
  db: Db,
  userId: number,
  recurringStreamId: number,
): Promise<{ ok: boolean; reason?: string }> {
  const [stream] = await db
    .select()
    .from(recurringStreams)
    .where(and(eq(recurringStreams.id, recurringStreamId), eq(recurringStreams.userId, userId)))
    .limit(1);
  if (!stream) return { ok: false, reason: 'recurring stream not found' };

  await db
    .insert(moneyWins)
    .values({
      userId,
      kind: 'subscription_canceled',
      description: `Canceled ${stream.merchantClean} — avoiding a ${stream.cadence} $${(stream.avgAmountCents / 100).toFixed(2)} charge.`,
      amountCents: 0, // accrues as avoided charges are confirmed
      status: 'estimated',
      dedupeKey: `subcancel:${recurringStreamId}`,
      sourceRecurringStreamId: recurringStreamId,
      expectedChargeCents: stream.avgAmountCents,
      verifyCyclesRequired: 2,
      lastCheckedDate: isoDate(new Date()),
    })
    .onConflictDoNothing({ target: [moneyWins.userId, moneyWins.dedupeKey] });

  // The stream is no longer active once the user says they canceled.
  await db
    .update(recurringStreams)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(recurringStreams.id, recurringStreamId));

  return { ok: true };
}

/**
 * Record a *verified* anomaly-recovery win — the user confirmed they got money
 * back on a flagged duplicate/fee, so it's realized, not estimated.
 */
export async function recordAnomalyRecovery(
  db: Db,
  userId: number,
  anomalyId: number,
): Promise<{ ok: boolean; reason?: string }> {
  const [anomaly] = await db
    .select()
    .from(anomalies)
    .where(and(eq(anomalies.id, anomalyId), eq(anomalies.userId, userId)))
    .limit(1);
  if (!anomaly) return { ok: false, reason: 'anomaly not found' };

  await db
    .insert(moneyWins)
    .values({
      userId,
      kind: 'anomaly_caught',
      description: `Recovered ${anomaly.title.toLowerCase()} — $${(anomaly.amountCents / 100).toFixed(2)} back.`,
      amountCents: anomaly.amountCents,
      status: 'verified',
      userConfirmed: true,
      verifiedAt: new Date(),
      dedupeKey: `anomalyrecover:${anomalyId}`,
    })
    .onConflictDoNothing({ target: [moneyWins.userId, moneyWins.dedupeKey] });

  await db.update(anomalies).set({ status: 'acknowledged' }).where(eq(anomalies.id, anomalyId));
  return { ok: true };
}

/** User confirms a subscription cancellation — verifies the win immediately (§4). */
export async function confirmMoneyWin(db: Db, userId: number, winId: number): Promise<{ ok: boolean }> {
  const [win] = await db
    .select()
    .from(moneyWins)
    .where(and(eq(moneyWins.id, winId), eq(moneyWins.userId, userId)))
    .limit(1);
  if (!win) return { ok: false };
  // If no cycle has accrued yet, credit one expected charge on confirmation.
  const amountCents = win.amountCents > 0 ? win.amountCents : (win.expectedChargeCents ?? win.amountCents);
  await db
    .update(moneyWins)
    .set({ userConfirmed: true, status: 'verified', amountCents, verifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(moneyWins.id, win.id));
  return { ok: true };
}

/**
 * Automated verifier (§4 Stage 5). For each estimated subscription-cancel win,
 * check whether the expected charge stayed absent through complete billing
 * cycles. A charge merely disappearing once proves nothing — the win only
 * verifies after `verifyCyclesRequired` clean cycles, and only while the item
 * is actively syncing (stale sync = incomplete data, so we don't advance). If
 * the expected charge reappears, the cancellation didn't stick and the win is
 * removed.
 */
export async function verifyMoneyWins(db: Db, userId: number): Promise<void> {
  const wins = await db
    .select()
    .from(moneyWins)
    .where(
      and(
        eq(moneyWins.userId, userId),
        eq(moneyWins.kind, 'subscription_canceled'),
        eq(moneyWins.status, 'estimated'),
        eq(moneyWins.userConfirmed, false),
      ),
    );
  if (wins.length === 0) return;

  const now = new Date();
  const today = isoDate(now);

  for (const win of wins) {
    if (win.sourceRecurringStreamId === null || win.expectedChargeCents === null) continue;
    const [stream] = await db
      .select()
      .from(recurringStreams)
      .where(eq(recurringStreams.id, win.sourceRecurringStreamId))
      .limit(1);
    if (!stream) continue;

    // Require an actively-syncing item for this account (data completeness).
    const [item] = await db
      .select({ status: items.status, lastSyncedAt: items.lastSyncedAt })
      .from(items)
      .innerJoin(accounts, eq(accounts.itemId, items.id))
      .where(eq(accounts.id, stream.accountId))
      .limit(1);
    const syncFresh =
      item?.status === 'active' &&
      item.lastSyncedAt !== null &&
      now.getTime() - item.lastSyncedAt.getTime() <= SYNC_STALE_DAYS * DAY_MS;
    if (!syncFresh) continue;

    const periodDays = CADENCE_DAYS[stream.cadence] ?? 31;
    const lastChecked = win.lastCheckedDate ?? isoDate(win.createdAt);
    const elapsedDays = (Date.parse(today) - Date.parse(lastChecked)) / DAY_MS;
    const cyclesElapsed = Math.floor(elapsedDays / periodDays);
    if (cyclesElapsed < 1) continue; // not a full cycle yet

    // Did the expected charge reappear since we last checked?
    const windowStart = lastChecked;
    const candidates = await db
      .select({
        name: transactions.name,
        merchantName: transactions.merchantName,
        amountCents: transactions.amountCents,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, stream.accountId),
          isNull(transactions.removedAt),
          isNull(transactions.supersededAt),
          eq(transactions.pending, false),
          gte(transactions.postedDate, windowStart),
          lte(transactions.postedDate, today),
        ),
      );
    const tolerance = Math.max(100, Math.round(win.expectedChargeCents * 0.1));
    const reappeared = candidates.some(
      (c) =>
        computeMerchantKey(c.name, c.merchantName) === stream.merchantKey &&
        Math.abs(c.amountCents - win.expectedChargeCents!) <= tolerance,
    );

    if (reappeared) {
      // Cancellation didn't stick — not a win.
      await db.delete(moneyWins).where(eq(moneyWins.id, win.id));
      await db
        .update(recurringStreams)
        .set({ active: true, updatedAt: new Date() })
        .where(eq(recurringStreams.id, stream.id));
      continue;
    }

    const newCyclesObserved = win.cyclesObserved + cyclesElapsed;
    const newAmount = win.amountCents + cyclesElapsed * win.expectedChargeCents;
    const verified = newCyclesObserved >= win.verifyCyclesRequired;
    await db
      .update(moneyWins)
      .set({
        cyclesObserved: newCyclesObserved,
        amountCents: newAmount,
        lastCheckedDate: today,
        status: verified ? 'verified' : 'estimated',
        verifiedAt: verified ? now : null,
        updatedAt: now,
      })
      .where(eq(moneyWins.id, win.id));
  }
}

/** The Money Wins ledger screen (§2): verified vs estimated tally + the list. */
export async function getMoneyWinsSummary(db: Db, userId: number): Promise<MoneyWinsSummaryView> {
  const rows = await db
    .select()
    .from(moneyWins)
    .where(eq(moneyWins.userId, userId))
    .orderBy(sql`${moneyWins.createdAt} desc`);

  let verifiedTotalCents = 0;
  let estimatedTotalCents = 0;
  for (const w of rows) {
    if (w.status === 'verified') verifiedTotalCents += w.amountCents;
    else estimatedTotalCents += w.amountCents;
  }

  return {
    verifiedTotalCents,
    estimatedTotalCents,
    wins: rows.map((w) => ({
      id: w.id,
      kind: w.kind,
      description: w.description,
      amountCents: w.amountCents,
      status: w.status,
      createdAt: w.createdAt.toISOString(),
    })),
  };
}
