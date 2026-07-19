import crypto from 'node:crypto';
import type {
  AnomalyView,
  EnrichedTransactionView,
  GoalView,
  HouseholdStatusView,
  InsightClaim,
  InsightView,
  LinkedItem,
  NotificationPreferencesView,
  PrivacyDeletionEventView,
  VoiceBriefView,
  VoiceBriefSegmentView,
} from '@zenfinance/shared';
import { and, asc, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { getBillingStatus } from '../billing/service.js';
import { computeGoalPacing, type Goal } from '../coaching/goals.js';
import { getMoneyWinsSummary } from '../coaching/moneyWins.js';
import type { Db } from '../db/client.js';
import {
  accounts,
  anomalies,
  appEvents,
  billingEvents,
  categoryCorrections,
  chatMessages,
  goals,
  householdGoalContributions,
  householdGoals,
  householdInvites,
  householdMembers,
  households,
  insights,
  items,
  notificationPreferences,
  pushTokens,
  recurringStreams,
  referralCodes,
  referralCredits,
  referralRedemptions,
  privacyDeletionEvents,
  providerRevocationJobs,
  transactionEnrichments,
  transactions,
  users,
  voiceBriefs,
} from '../db/schema.js';
import { env } from '../env.js';
import { getRecentWeeklyNetCents } from '../features/rollup.js';
import { decryptToken } from '../lib/crypto.js';
import { safeErrorSummary } from '../lib/safeError.js';
import { getProvider } from '../providers/index.js';
import { moneyPhysicalReportsForExport } from '../moneyPhysical/service.js';

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function emailHash(email: string): string {
  return crypto.createHash('sha256').update(`${env.JWT_SECRET}:${email.toLowerCase()}`).digest('hex');
}

async function itemViews(db: Db, userId: number): Promise<LinkedItem[]> {
  const rows = await db
    .select({
      itemId: items.id,
      provider: items.provider,
      institutionName: items.institutionName,
      status: items.status,
      lastSyncedAt: items.lastSyncedAt,
      accountId: accounts.id,
      accountName: accounts.name,
      accountType: accounts.type,
      accountSubtype: accounts.subtype,
      mask: accounts.mask,
      currentBalanceCents: accounts.currentBalanceCents,
      isoCurrency: accounts.isoCurrency,
    })
    .from(items)
    .leftJoin(accounts, eq(accounts.itemId, items.id))
    .where(eq(items.userId, userId))
    .orderBy(desc(items.createdAt), asc(accounts.id));

  const byItem = new Map<number, LinkedItem>();
  for (const row of rows) {
    if (!byItem.has(row.itemId)) {
      byItem.set(row.itemId, {
        id: row.itemId,
        provider: row.provider,
        institutionName: row.institutionName,
        status: row.status,
        lastSyncedAt: toIso(row.lastSyncedAt),
        accounts: [],
      });
    }
    if (row.accountId) {
      byItem.get(row.itemId)!.accounts.push({
        id: row.accountId,
        name: row.accountName ?? 'Account',
        type: row.accountType ?? 'unknown',
        subtype: row.accountSubtype,
        mask: row.mask,
        currentBalanceCents: row.currentBalanceCents,
        isoCurrency: row.isoCurrency ?? 'USD',
      });
    }
  }
  return [...byItem.values()];
}

async function transactionViews(
  db: Db,
  userId: number,
  page: { limit: number; offset: number },
): Promise<EnrichedTransactionView[]> {
  const accountRows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .innerJoin(items, eq(accounts.itemId, items.id))
    .where(eq(items.userId, userId));
  const accountIds = accountRows.map((a) => a.id);
  if (accountIds.length === 0) return [];

  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      amountCents: transactions.amountCents,
      isoCurrency: transactions.isoCurrency,
      postedDate: transactions.postedDate,
      name: transactions.name,
      merchantName: transactions.merchantName,
      pending: transactions.pending,
      transferPairId: transactions.transferPairId,
      category: transactionEnrichments.category,
      merchantClean: transactionEnrichments.merchantClean,
      isDiscretionary: transactionEnrichments.isDiscretionary,
      isRecurring: transactionEnrichments.isRecurring,
      confidence: transactionEnrichments.confidence,
      enrichmentSource: transactionEnrichments.source,
    })
    .from(transactions)
    .leftJoin(
      transactionEnrichments,
      and(eq(transactionEnrichments.transactionId, transactions.id), isNull(transactionEnrichments.supersededAt)),
    )
    .where(and(inArray(transactions.accountId, accountIds), isNull(transactions.removedAt), isNull(transactions.supersededAt)))
    .orderBy(desc(transactions.postedDate), desc(transactions.id))
    .limit(page.limit)
    .offset(page.offset);

  return rows.map((t) => ({
    id: t.id,
    accountId: t.accountId,
    amountCents: t.amountCents,
    isoCurrency: t.isoCurrency,
    postedDate: t.postedDate,
    name: t.name,
    merchantName: t.merchantName,
    pending: t.pending,
    transferPairId: t.transferPairId,
    category: t.category,
    merchantClean: t.merchantClean,
    isDiscretionary: t.isDiscretionary,
    isRecurring: t.isRecurring,
    confidence: t.confidence,
    enrichmentSource: t.enrichmentSource,
  }));
}

async function goalViews(db: Db, userId: number): Promise<GoalView[]> {
  const [rows, weeklyNet] = await Promise.all([
    db.select().from(goals).where(eq(goals.userId, userId)).orderBy(asc(goals.priority), asc(goals.id)),
    getRecentWeeklyNetCents(db, userId),
  ]);
  return rows.map((goal: Goal) => {
    const pacing = computeGoalPacing(goal, weeklyNet);
    return {
      id: goal.id,
      name: goal.name,
      targetAmountCents: goal.targetAmountCents,
      currentAmountCents: goal.currentAmountCents,
      targetDate: goal.targetDate,
      priority: goal.priority,
      status: goal.status,
      pacing: {
        remainingAmountCents: pacing.remainingAmountCents,
        progressRatio: pacing.progressRatio,
        weeksRemaining: pacing.weeksRemaining,
        weeklyTargetCents: pacing.weeklyTargetCents,
        projectedCompletionDate: pacing.projectedCompletionDate,
        pacingStatus: pacing.pacingStatus,
      },
    };
  });
}

async function insightViews(db: Db, userId: number): Promise<InsightView[]> {
  const rows = await db.select().from(insights).where(eq(insights.userId, userId)).orderBy(desc(insights.createdAt));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    weekStart: row.weekStart,
    headline: row.headline,
    body: row.body,
    action: {
      description: row.actionDescription,
      estimatedImpactCents: row.actionEstimatedImpactCents,
      timeframe: row.actionTimeframe,
    },
    claims: (row.claims as InsightClaim[]) ?? [],
    toneCheck: row.toneCheck,
    source: row.source,
    feedbackRating: row.feedbackRating,
    feedbackFollowedThrough: row.feedbackFollowedThrough,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function anomalyViews(db: Db, userId: number): Promise<AnomalyView[]> {
  const rows = await db.select().from(anomalies).where(eq(anomalies.userId, userId)).orderBy(desc(anomalies.createdAt));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    amountCents: row.amountCents,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));
}

async function notificationPrefs(db: Db, userId: number): Promise<NotificationPreferencesView | null> {
  const [[row], [pushToken]] = await Promise.all([
    db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1),
    db.select({ id: pushTokens.id }).from(pushTokens).where(eq(pushTokens.userId, userId)).limit(1),
  ]);
  if (!row) return null;
  return {
    weeklyBrief: row.weeklyBrief,
    anomalies: row.anomalies,
    goalPacing: row.goalPacing,
    marketing: row.marketing,
    pushEnabled: Boolean(pushToken),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function householdExport(db: Db, userId: number): Promise<HouseholdStatusView> {
  const [membership] = await db
    .select({ householdId: householdMembers.householdId, role: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);
  if (!membership) return { household: null };
  const [household] = await db.select().from(households).where(eq(households.id, membership.householdId)).limit(1);
  const [memberRows, inviteRows, goalRows] = await Promise.all([
    db
      .select({
        id: householdMembers.id,
        userId: householdMembers.userId,
        email: users.email,
        role: householdMembers.role,
        privacyMode: householdMembers.privacyMode,
        joinedAt: householdMembers.joinedAt,
      })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(eq(householdMembers.householdId, membership.householdId)),
    db.select().from(householdInvites).where(eq(householdInvites.householdId, membership.householdId)),
    db.select().from(householdGoals).where(eq(householdGoals.householdId, membership.householdId)).orderBy(asc(householdGoals.priority), asc(householdGoals.id)),
  ]);
  const goalIds = goalRows.map((goal) => goal.id);
  const contributions =
    goalIds.length === 0
      ? []
      : await db
          .select({
            id: householdGoalContributions.id,
            goalId: householdGoalContributions.goalId,
            userId: householdGoalContributions.userId,
            userEmail: users.email,
            amountCents: householdGoalContributions.amountCents,
            note: householdGoalContributions.note,
            contributedAt: householdGoalContributions.contributedAt,
          })
          .from(householdGoalContributions)
          .leftJoin(users, eq(users.id, householdGoalContributions.userId))
          .where(inArray(householdGoalContributions.goalId, goalIds))
          .orderBy(desc(householdGoalContributions.contributedAt));
  const contributionsByGoal = new Map<number, typeof contributions>();
  for (const contribution of contributions) {
    const list = contributionsByGoal.get(contribution.goalId) ?? [];
    list.push(contribution);
    contributionsByGoal.set(contribution.goalId, list);
  }

  return {
    household: {
      id: household!.id,
      name: household!.name,
      seatLimit: household!.seatLimit,
      privacyMode: 'individual',
      currentUserRole: membership.role === 'owner' ? 'owner' : 'member',
      members: memberRows.map((member) => ({
        id: member.id,
        userId: member.userId,
        email: member.email,
        role: member.role === 'owner' ? 'owner' : 'member',
        privacyMode: 'individual',
        joinedAt: member.joinedAt.toISOString(),
      })),
      invites: inviteRows.map((invite) => ({
        id: invite.id,
        email: invite.email,
        status: invite.status === 'accepted' || invite.status === 'revoked' || invite.status === 'expired' ? invite.status : 'pending',
        expiresAt: invite.expiresAt.toISOString(),
        createdAt: invite.createdAt.toISOString(),
      })),
      goals: goalRows.map((goal) => ({
        id: goal.id,
        name: goal.name,
        targetAmountCents: goal.targetAmountCents,
        currentAmountCents: goal.currentAmountCents,
        targetDate: goal.targetDate,
        priority: goal.priority,
        status: goal.status,
        createdByUserId: goal.createdByUserId,
        progressRatio: goal.targetAmountCents > 0 ? Math.min(1, Number((goal.currentAmountCents / goal.targetAmountCents).toFixed(4))) : 0,
        remainingAmountCents: Math.max(0, goal.targetAmountCents - goal.currentAmountCents),
        contributions: (contributionsByGoal.get(goal.id) ?? []).map((contribution) => ({
          id: contribution.id,
          userId: contribution.userId,
          userEmail: contribution.userEmail,
          amountCents: contribution.amountCents,
          note: contribution.note,
          contributedAt: contribution.contributedAt.toISOString(),
        })),
        createdAt: goal.createdAt.toISOString(),
        updatedAt: goal.updatedAt.toISOString(),
      })),
      createdAt: household!.createdAt.toISOString(),
      updatedAt: household!.updatedAt.toISOString(),
    },
  };
}

async function voiceBriefViews(db: Db, userId: number): Promise<VoiceBriefView[]> {
  const rows = await db
    .select({
      id: voiceBriefs.id,
      insightId: voiceBriefs.insightId,
      insightKind: insights.kind,
      headline: insights.headline,
      script: voiceBriefs.script,
      segments: voiceBriefs.segments,
      durationSeconds: voiceBriefs.durationSeconds,
      playCount: voiceBriefs.playCount,
      completedAt: voiceBriefs.completedAt,
      createdAt: voiceBriefs.createdAt,
      updatedAt: voiceBriefs.updatedAt,
    })
    .from(voiceBriefs)
    .innerJoin(insights, eq(insights.id, voiceBriefs.insightId))
    .where(eq(voiceBriefs.userId, userId))
    .orderBy(desc(voiceBriefs.createdAt));
  return rows.map((row) => ({
    id: row.id,
    insightId: row.insightId,
    insightKind: row.insightKind,
    headline: row.headline,
    script: row.script,
    durationSeconds: row.durationSeconds,
    segments: (row.segments as VoiceBriefSegmentView[]) ?? [],
    playCount: row.playCount,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

type ExportWriter = (chunk: string) => Promise<void>;
const EXPORT_PAGE_SIZE = 250;

async function writeJsonValue(write: ExportWriter, value: unknown): Promise<void> {
  await write(JSON.stringify(value) ?? 'null');
}

async function writePagedJsonArray<T>(
  write: ExportWriter,
  loadPage: (limit: number, offset: number) => Promise<T[]>,
): Promise<void> {
  await write('[');
  let first = true;
  for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
    const rows = await loadPage(EXPORT_PAGE_SIZE, offset);
    for (const row of rows) {
      if (!first) await write(',');
      await writeJsonValue(write, row);
      first = false;
    }
    if (rows.length < EXPORT_PAGE_SIZE) break;
  }
  await write(']');
}

/**
 * Write a complete privacy export incrementally. Large transaction and event
 * collections are paged and serialized one row at a time so one request
 * cannot retain every user-owned row in API memory or fan out dozens of
 * simultaneous database queries.
 */
export async function streamUserDataExport(db: Db, userId: number, write: ExportWriter): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return false;

  await write('{"generatedAt":');
  await writeJsonValue(write, new Date().toISOString());
  await write(',"user":');
  await writeJsonValue(write, {
    id: user.id,
    email: user.email,
    appleLinked: Boolean(user.appleSub),
    createdAt: user.createdAt.toISOString(),
  });

  const writeField = async (name: string, load: () => Promise<unknown>): Promise<void> => {
    await write(`,"${name}":`);
    await writeJsonValue(write, await load());
  };
  await writeField('items', () => itemViews(db, userId));
  await write(',"transactions":');
  await writePagedJsonArray(write, (limit, offset) => transactionViews(db, userId, { limit, offset }));
  await writeField('goals', () => goalViews(db, userId));
  await writeField('insights', () => insightViews(db, userId));
  await writeField('anomalies', () => anomalyViews(db, userId));
  await writeField('moneyWins', () => getMoneyWinsSummary(db, userId));
  await writeField('billing', () => getBillingStatus(db, userId));
  await writeField('notificationPreferences', () => notificationPrefs(db, userId));
  await writeField('household', () => householdExport(db, userId));
  await writeField('voiceBriefs', () => voiceBriefViews(db, userId));
  await writeField('moneyPhysicalReports', () => moneyPhysicalReportsForExport(db, userId));

  await write(',"supplementalData":{');
  const writeSupplemental = async <T>(
    name: string,
    first: boolean,
    loadPage: (limit: number, offset: number) => Promise<T[]>,
  ): Promise<void> => {
    if (!first) await write(',');
    await write(`"${name}":`);
    await writePagedJsonArray(write, loadPage);
  };
  await writeSupplemental('appEvents', true, (limit, offset) =>
    db.select().from(appEvents).where(eq(appEvents.userId, userId)).orderBy(asc(appEvents.id)).limit(limit).offset(offset));
  await writeSupplemental('billingEvents', false, (limit, offset) =>
    db.select().from(billingEvents).where(eq(billingEvents.userId, userId)).orderBy(asc(billingEvents.id)).limit(limit).offset(offset));
  await writeSupplemental('chatMessages', false, (limit, offset) =>
    db.select().from(chatMessages).where(eq(chatMessages.userId, userId)).orderBy(asc(chatMessages.id)).limit(limit).offset(offset));
  await writeSupplemental('categoryCorrections', false, (limit, offset) =>
    db.select().from(categoryCorrections).where(eq(categoryCorrections.userId, userId)).orderBy(asc(categoryCorrections.id)).limit(limit).offset(offset));
  await writeSupplemental('recurringStreams', false, (limit, offset) =>
    db.select().from(recurringStreams).where(eq(recurringStreams.userId, userId)).orderBy(asc(recurringStreams.id)).limit(limit).offset(offset));
  await writeSupplemental('referralCodes', false, (limit, offset) =>
    db.select().from(referralCodes).where(eq(referralCodes.userId, userId)).orderBy(asc(referralCodes.userId)).limit(limit).offset(offset));
  await writeSupplemental('referralRedemptions', false, (limit, offset) =>
    db.select().from(referralRedemptions)
      .where(or(eq(referralRedemptions.referrerUserId, userId), eq(referralRedemptions.referredUserId, userId)))
      .orderBy(asc(referralRedemptions.id)).limit(limit).offset(offset));
  await writeSupplemental('referralCredits', false, (limit, offset) =>
    db.select().from(referralCredits)
      .where(or(eq(referralCredits.recipientUserId, userId), eq(referralCredits.sourceUserId, userId)))
      .orderBy(asc(referralCredits.id)).limit(limit).offset(offset));
  await write('}}');
  return true;
}

export async function deleteUserAccount(db: Db, userId: number): Promise<PrivacyDeletionEventView | null> {
  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  const userItems = await db.select().from(items).where(eq(items.userId, userId));
  let failures = 0;
  const revocationJobs: Array<{
    provider: string;
    encryptedAccessToken: string;
    lastError: string;
    nextAttemptAt: Date;
  }> = [];
  for (const item of userItems) {
    try {
      await getProvider().removeItem(decryptToken(item.encryptedAccessToken));
    } catch (err) {
      failures += 1;
      console.error(`[privacy] provider removeItem failed for item ${item.id}:`, safeErrorSummary(err));
      revocationJobs.push({
        provider: item.provider,
        encryptedAccessToken: item.encryptedAccessToken,
        lastError: err instanceof Error ? err.message.slice(0, 500) : 'Unknown provider revocation error',
        nextAttemptAt: new Date(Date.now() + 60_000),
      });
    }
  }

  const completedAt = new Date();
  // Queue failed processor revocations, erase local data, and create the
  // completion record atomically. No durable "completed" evidence is visible
  // unless the local deletion itself commits.
  const event = await db.transaction(async (tx) => {
    if (revocationJobs.length > 0) await tx.insert(providerRevocationJobs).values(revocationJobs);
    const [createdEvent] = await tx.insert(privacyDeletionEvents).values({
      userId,
      emailHash: emailHash(user.email),
      itemCount: userItems.length,
      providerRevocationFailures: failures,
      processorDeletionStatus: {
        plaid: { attempted: userItems.length, failed: failures, revoked: userItems.length - failures },
        database: 'cascade_delete_completed',
        backups: 'expires_within_30_days',
        modelProvider: 'no_raw_transaction_exports_are_stored_by_zenfinance',
        sentry: 'sendDefaultPii_false_and_scrubbed_before_send',
      },
      completedAt,
    })
    .returning({ id: privacyDeletionEvents.id, completedAt: privacyDeletionEvents.completedAt });
    // These audit tables intentionally use SET NULL for aggregate metrics, so
    // delete the user's identifiable/raw payload rows explicitly.
    await tx.delete(appEvents).where(eq(appEvents.userId, userId));
    await tx.delete(billingEvents).where(eq(billingEvents.userId, userId));
    await tx.delete(users).where(eq(users.id, userId));
    return createdEvent!;
  });
  return { ok: true, deletionEventId: event!.id, completedAt: (event!.completedAt ?? completedAt).toISOString() };
}

export async function processPendingProviderRevocations(db: Db): Promise<void> {
  const jobs = await db
    .select()
    .from(providerRevocationJobs)
    .where(and(isNull(providerRevocationJobs.completedAt), lte(providerRevocationJobs.nextAttemptAt, new Date())))
    .limit(25);
  for (const job of jobs) {
    try {
      await getProvider().removeItem(decryptToken(job.encryptedAccessToken));
      await db
        .update(providerRevocationJobs)
        .set({ encryptedAccessToken: '', completedAt: new Date(), lastError: null })
        .where(eq(providerRevocationJobs.id, job.id));
    } catch (err) {
      const attempts = job.attempts + 1;
      const delay = Math.min(24 * 60 * 60_000, 60_000 * 2 ** Math.min(attempts, 10));
      await db
        .update(providerRevocationJobs)
        .set({
          attempts,
          lastError: err instanceof Error ? err.message.slice(0, 500) : 'Unknown provider revocation error',
          nextAttemptAt: new Date(Date.now() + delay),
        })
        .where(eq(providerRevocationJobs.id, job.id));
    }
  }
}
