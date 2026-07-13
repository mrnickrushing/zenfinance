import {
  appEventSchema,
  chatQuestionSchema,
  notificationPreferencesSchema,
  pushTokenSchema,
  whatIfSchema,
  type AnomalyView,
  type AppEventInput,
  type ChatAnswerView,
  type ChatFactView,
  type EnrichedTransactionView,
  type GoalView,
  type InsightClaim,
  type InsightView,
  type LinkedItem,
  type MobileHomeSummaryView,
  type NotificationPreferencesInput,
  type NotificationPreferencesView,
  type PushTokenInput,
  type WhatIfGoalProjectionView,
  type WhatIfInput,
  type WhatIfResultView,
} from '@zenfinance/shared';
import type { InferSelectModel } from 'drizzle-orm';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Response } from 'express';
import { Router } from 'express';
import { assertPremium, getBillingStatus } from '../billing/service.js';
import { generateGroundedChatAnswer } from '../chat/anthropic.js';
import { assembleCoachingContext } from '../coaching/derive.js';
import { auditSubscriptions } from '../coaching/subscriptions.js';
import { computeGoalPacing, type Goal } from '../coaching/goals.js';
import { getMoneyWinsSummary } from '../coaching/moneyWins.js';
import { computeZenScore } from '../coaching/zenScore.js';
import { db } from '../db/client.js';
import {
  accounts,
  anomalies,
  appEvents,
  chatMessages,
  featureRollups,
  goals,
  insights,
  items,
  notificationPreferences,
  pushTokens,
  transactionEnrichments,
  transactions,
} from '../db/schema.js';
import { getRecentWeeklyNetCents } from '../features/rollup.js';
import { safeErrorSummary } from '../lib/safeError.js';
import { getMoneyPhysicalStatus } from '../moneyPhysical/service.js';
import { requireUser } from '../middleware/userAuth.js';
import { userRateLimit } from '../middleware/userRateLimit.js';
import { validateBody } from '../middleware/validate.js';

type InsightRow = InferSelectModel<typeof insights>;

const STOP_WORDS = new Set([
  'a',
  'about',
  'all',
  'am',
  'an',
  'and',
  'any',
  'at',
  'can',
  'did',
  'do',
  'for',
  'from',
  'have',
  'how',
  'i',
  'in',
  'is',
  'it',
  'last',
  'me',
  'month',
  'much',
  'my',
  'on',
  'spend',
  'spent',
  'the',
  'this',
  'to',
  'was',
  'week',
  'what',
  'with',
]);

function cents(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${(Math.abs(amount) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(d: Date, months: number): Date {
  const copy = new Date(d);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function dateWindow(question: string): { start: string; end: string; label: string } {
  const now = new Date();
  const lower = question.toLowerCase();
  if (lower.includes('last month')) {
    const end = startOfMonth(now);
    const start = addMonths(end, -1);
    return { start: isoDate(start), end: isoDate(end), label: 'last month' };
  }
  if (lower.includes('this month')) {
    const start = startOfMonth(now);
    return { start: isoDate(start), end: isoDate(addDays(now, 1)), label: 'this month' };
  }
  if (lower.includes('last 90') || lower.includes('90 days')) {
    return { start: isoDate(addDays(now, -90)), end: isoDate(addDays(now, 1)), label: 'the last 90 days' };
  }
  if (lower.includes('last 30') || lower.includes('30 days')) {
    return { start: isoDate(addDays(now, -30)), end: isoDate(addDays(now, 1)), label: 'the last 30 days' };
  }
  if (lower.includes('this year')) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return { start: isoDate(start), end: isoDate(addDays(now, 1)), label: 'this year' };
  }
  return { start: isoDate(addDays(now, -30)), end: isoDate(addDays(now, 1)), label: 'the last 30 days' };
}

function insightToView(row: InsightRow): InsightView {
  return {
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
  };
}

function goalToView(goal: Goal, recentWeeklyNetCents: number): GoalView {
  const pacing = computeGoalPacing(goal, recentWeeklyNetCents);
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
}

async function userAccountIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .innerJoin(items, eq(accounts.itemId, items.id))
    .where(eq(items.userId, userId));
  return rows.map((r) => r.id);
}

async function linkedItems(userId: number): Promise<LinkedItem[]> {
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
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
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

async function recentTransactions(userId: number, limit = 20): Promise<EnrichedTransactionView[]> {
  const accountIds = await userAccountIds(userId);
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
    .limit(limit);

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

async function latestInsight(userId: number, kind: 'first_look' | 'weekly_brief'): Promise<InsightView | null> {
  const [row] = await db
    .select()
    .from(insights)
    .where(and(eq(insights.userId, userId), eq(insights.kind, kind)))
    .orderBy(desc(insights.createdAt))
    .limit(1);
  return row ? insightToView(row) : null;
}

async function listGoals(userId: number): Promise<GoalView[]> {
  const [rows, weeklyNet] = await Promise.all([
    db.select().from(goals).where(eq(goals.userId, userId)).orderBy(asc(goals.priority), asc(goals.id)),
    getRecentWeeklyNetCents(db, userId),
  ]);
  return rows.map((g) => goalToView(g, weeklyNet));
}

async function openAnomalies(userId: number): Promise<AnomalyView[]> {
  const rows = await db
    .select()
    .from(anomalies)
    .where(and(eq(anomalies.userId, userId), eq(anomalies.status, 'open')))
    .orderBy(desc(anomalies.amountCents))
    .limit(20);
  return rows.map((a) => ({
    id: a.id,
    kind: a.kind,
    title: a.title,
    detail: a.detail,
    amountCents: a.amountCents,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
  }));
}

async function transactionCount(userId: number): Promise<number> {
  const accountIds = await userAccountIds(userId);
  if (accountIds.length === 0) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(transactions)
    .where(and(inArray(transactions.accountId, accountIds), isNull(transactions.removedAt), isNull(transactions.supersededAt)));
  return row?.n ?? 0;
}

function questionTerms(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[$,]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

async function answerSpendingQuestion(userId: number, question: string): Promise<Omit<ChatAnswerView, 'id' | 'createdAt'> | null> {
  const lower = question.toLowerCase();
  if (!/(spend|spent|cost|pay|paid|much)/.test(lower)) return null;

  const accountIds = await userAccountIds(userId);
  if (accountIds.length === 0) {
    return {
      answer: 'Link an account first and I can answer spending questions from your transactions.',
      facts: [],
      actions: ['Link a bank account'],
    };
  }

  const window = dateWindow(question);
  const terms = questionTerms(question);
  const rows = await db
    .select({
      amountCents: transactions.amountCents,
      postedDate: transactions.postedDate,
      name: transactions.name,
      merchantName: transactions.merchantName,
      category: transactionEnrichments.category,
      merchantClean: transactionEnrichments.merchantClean,
    })
    .from(transactions)
    .leftJoin(
      transactionEnrichments,
      and(eq(transactionEnrichments.transactionId, transactions.id), isNull(transactionEnrichments.supersededAt)),
    )
    .where(
      and(
        inArray(transactions.accountId, accountIds),
        isNull(transactions.removedAt),
        isNull(transactions.supersededAt),
        sql`${transactions.pending} = false`,
        sql`${transactions.postedDate} >= ${window.start}`,
        sql`${transactions.postedDate} < ${window.end}`,
      ),
    )
    .orderBy(desc(transactions.postedDate))
    .limit(500);

  const filtered = terms.length
    ? rows.filter((r) => {
        const haystack = `${r.name} ${r.merchantName ?? ''} ${r.merchantClean ?? ''} ${r.category ?? ''}`.toLowerCase();
        return terms.some((term) => haystack.includes(term));
      })
    : rows;

  const spendingRows = filtered.filter((r) => r.amountCents > 0);
  const total = spendingRows.reduce((sum, r) => sum + r.amountCents, 0);
  const label = terms.length ? terms.join(', ') : 'spending';
  const facts: ChatFactView[] = [
    { label: `${label} in ${window.label}`, amountCents: total, source: 'transaction_query' },
  ];
  const top = [...spendingRows]
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 3)
    .map((r) => `${r.merchantClean ?? r.merchantName ?? r.name} (${cents(r.amountCents)})`);
  return {
    answer:
      spendingRows.length === 0
        ? `I did not find matching spending in ${window.label}.`
        : `You spent ${cents(total)} on ${label} in ${window.label} across ${spendingRows.length} transaction${
            spendingRows.length === 1 ? '' : 's'
          }.${top.length ? ` The biggest charges were ${top.join(', ')}.` : ''}`,
    facts,
    actions:
      total > 0
        ? [`Try trimming ${cents(Math.max(500, Math.round(total * 0.1)))} from this category next cycle.`]
        : ['Ask about a merchant, category, or date range after more transactions sync.'],
  };
}

async function answerAffordQuestion(userId: number, question: string): Promise<Omit<ChatAnswerView, 'id' | 'createdAt'> | null> {
  const lower = question.toLowerCase();
  if (!/(afford|buy|purchase|save for)/.test(lower)) return null;
  const amountMatch = question.match(/\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  const purchaseCents = amountMatch ? Math.round(Number(amountMatch[1]!.replace(/,/g, '')) * 100) : null;
  const [weeklyNet, goalRows] = await Promise.all([
    getRecentWeeklyNetCents(db, userId),
    db.select().from(goals).where(and(eq(goals.userId, userId), eq(goals.status, 'active'))).orderBy(asc(goals.priority)),
  ]);
  const activeGoal = goalRows[0] ? computeGoalPacing(goalRows[0], weeklyNet) : null;
  const facts: ChatFactView[] = [
    { label: 'Recent average weekly net', amountCents: weeklyNet, source: 'feature_rollup' },
  ];
  if (activeGoal) {
    facts.push({ label: 'Top goal remaining amount', amountCents: activeGoal.remainingAmountCents, source: 'goal' });
  }
  if (!purchaseCents) {
    return {
      answer: 'Give me a dollar amount and I can compare it with your recent cash flow and active goals.',
      facts,
      actions: ['Ask something like: Can I afford $600 next month?'],
    };
  }
  const weeksToCover = weeklyNet > 0 ? Math.ceil(purchaseCents / weeklyNet) : null;
  return {
    answer:
      weeklyNet <= 0
        ? `I would not treat ${cents(purchaseCents)} as comfortable right now because your recent weekly net is ${cents(
            weeklyNet,
          )}.`
        : `${cents(purchaseCents)} equals about ${weeksToCover} week${weeksToCover === 1 ? '' : 's'} of your recent surplus (${cents(
            weeklyNet,
          )}/week).${activeGoal ? ` It would also compete with ${cents(activeGoal.remainingAmountCents)} still left on your top goal.` : ''}`,
    facts: [...facts, { label: 'Asked purchase amount', amountCents: purchaseCents, source: 'transaction_query' }],
    actions:
      weeklyNet > 0
        ? [`Set aside ${cents(Math.ceil(purchaseCents / Math.max(1, weeksToCover ?? 1)))} per week before buying.`]
        : ['Delay the purchase until your weekly net is positive for at least two weeks.'],
  };
}

async function answerSubscriptionQuestion(userId: number, question: string): Promise<Omit<ChatAnswerView, 'id' | 'createdAt'> | null> {
  if (!/(subscription|recurring|cancel|zombie)/i.test(question)) return null;
  const audit = await auditSubscriptions(db, userId);
  const top = audit.items.filter((i) => i.isCancelCandidate).slice(0, 3);
  return {
    answer:
      top.length === 0
        ? `I found ${cents(audit.totalMonthlyCents)} in monthly-normalized recurring charges, but nothing stands out as an easy cancellation candidate yet.`
        : `I found ${cents(audit.cancelCandidateMonthlyCents)} per month in likely cancellation candidates. The top candidates are ${top
            .map((i) => `${i.merchantClean} (${cents(i.monthlyEquivalentCents)}/mo)`)
            .join(', ')}.`,
    facts: [
      { label: 'Total recurring monthly equivalent', amountCents: audit.totalMonthlyCents, source: 'subscription_audit' },
      {
        label: 'Likely cancellation candidates monthly equivalent',
        amountCents: audit.cancelCandidateMonthlyCents,
        source: 'subscription_audit',
      },
    ],
    actions: top[0] ? [`Review ${top[0].merchantClean} and use the cancellation script in Subscriptions.`] : ['Check again after the next sync.'],
  };
}

async function answerGoalQuestion(userId: number, question: string): Promise<Omit<ChatAnswerView, 'id' | 'createdAt'> | null> {
  if (!/(goal|on pace|on track|target date|move .* up)/i.test(question)) return null;
  const goalViews = await listGoals(userId);
  const goal = goalViews.find((item) => item.status === 'active') ?? goalViews[0];
  if (!goal) {
    return {
      answer: 'You do not have an active goal yet, so I cannot calculate goal pacing.',
      facts: [],
      actions: ['Create a goal with a target amount and date.'],
    };
  }
  const pacing = goal.pacing;
  const accelerationMatch = question.match(/(?:move|finish|reach).*?(\d+)\s*weeks?/i);
  const wordAcceleration = /\btwo weeks?\b/i.test(question) ? 2 : /\bone week\b/i.test(question) ? 1 : null;
  const accelerationWeeks = accelerationMatch ? Number(accelerationMatch[1]) : wordAcceleration;
  if (accelerationWeeks && accelerationWeeks > 0 && pacing.remainingAmountCents > 0) {
    const recentWeeklyNet = await getRecentWeeklyNetCents(db, userId);
    if (recentWeeklyNet <= 0) {
      return {
        answer: `${goal.name} cannot be accelerated from the current projection because recent weekly net savings are not positive.`,
        facts: [
          { label: `${goal.name} remaining`, amountCents: pacing.remainingAmountCents, source: 'goal' },
          { label: 'Recent average weekly net', amountCents: recentWeeklyNet, source: 'feature_rollup' },
        ],
        actions: ['Create a positive weekly surplus first, then recalculate the goal timeline.'],
      };
    }
    const currentWeeks = Math.ceil(pacing.remainingAmountCents / recentWeeklyNet);
    const acceleratedWeeks = Math.max(1, currentWeeks - accelerationWeeks);
    const requiredWeeklyNet = Math.ceil(pacing.remainingAmountCents / acceleratedWeeks);
    const extraWeeklyCents = Math.max(0, requiredWeeklyNet - recentWeeklyNet);
    return {
      answer: `To move ${goal.name} up by about ${accelerationWeeks} week${accelerationWeeks === 1 ? '' : 's'}, increase weekly savings by ${cents(
        extraWeeklyCents,
      )}, from ${cents(recentWeeklyNet)} to ${cents(requiredWeeklyNet)}.`,
      facts: [
        { label: `${goal.name} remaining`, amountCents: pacing.remainingAmountCents, source: 'goal' },
        { label: 'Recent average weekly net', amountCents: recentWeeklyNet, source: 'feature_rollup' },
        { label: 'Additional weekly savings needed', amountCents: extraWeeklyCents, source: 'goal' },
      ],
      actions: [`Add ${cents(extraWeeklyCents)} to weekly savings and review the projection after the next sync.`],
    };
  }
  const status = pacing.pacingStatus.replace(/_/g, ' ');
  return {
    answer: `${goal.name} is ${status}. You have ${cents(pacing.remainingAmountCents)} remaining.${
      pacing.projectedCompletionDate ? ` At your recent pace, the projected completion date is ${pacing.projectedCompletionDate}.` : ''
    }`,
    facts: [{ label: `${goal.name} remaining`, amountCents: pacing.remainingAmountCents, source: 'goal' }],
    actions: pacing.weeklyTargetCents
      ? [`Set aside ${cents(pacing.weeklyTargetCents)} per week to target ${goal.targetDate}.`]
      : ['Add a target date to turn this into a weekly savings target.'],
  };
}

async function answerBudgetQuestion(userId: number, question: string): Promise<Omit<ChatAnswerView, 'id' | 'createdAt'> | null> {
  if (!/(budget|spending limit|need to cut|cut to save)/i.test(question)) return null;
  const context = await assembleCoachingContext(db, userId, 'weekly_brief');
  const category = context.topDiscretionaryCategories[0];
  const requested = question.match(/\$?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  const requestedCents = requested ? Math.round(Number(requested[1]!.replace(/,/g, '')) * 100) : null;
  const requestsReduction = /(cut|save|reduce|trim)/i.test(question);
  if (!category) {
    if (requestedCents !== null && !requestsReduction) {
      return {
        answer: `Use ${cents(requestedCents)} as the weekly spending limit. I will be able to compare it with your actual category history after the next rollup.`,
        facts: [{ label: 'Requested weekly spending limit', amountCents: requestedCents, source: 'transaction_query' }],
        actions: [`Set a ${cents(requestedCents)} weekly spending limit.`],
      };
    }
    return {
      answer: 'I need at least a week of categorized spending before I can recommend a grounded budget limit.',
      facts: [],
      actions: ['Sync transactions, then ask again after your first weekly rollup.'],
    };
  }
  const suggestedLimitCents =
    requestedCents !== null && !requestsReduction
      ? requestedCents
      : Math.max(0, category.amountCents - (requestedCents ?? Math.max(500, Math.round(category.amountCents * 0.1))));
  const suggestedCutCents = Math.max(0, category.amountCents - suggestedLimitCents);
  return {
    answer: `Your largest recent discretionary category is ${category.label} at ${cents(category.amountCents)} this week. A starting weekly limit of ${cents(
      suggestedLimitCents,
    )} would create ${cents(Math.min(suggestedCutCents, category.amountCents))} of room if your pattern holds.`,
    facts: [{ label: `${category.label} spend this week`, amountCents: category.amountCents, source: 'feature_rollup' }],
    actions: [`Set a ${cents(suggestedLimitCents)} weekly limit for ${category.label}.`, 'Review the limit after two full weeks.'],
  };
}

async function answerGeneralQuestion(userId: number): Promise<Omit<ChatAnswerView, 'id' | 'createdAt'>> {
  const [weekly, firstLook, wins, goalViews] = await Promise.all([
    latestInsight(userId, 'weekly_brief'),
    latestInsight(userId, 'first_look'),
    getMoneyWinsSummary(db, userId),
    listGoals(userId),
  ]);
  const brief = weekly ?? firstLook;
  const topGoal = goalViews[0];
  const facts: ChatFactView[] = [
    { label: 'Verified Money Wins', amountCents: wins.verifiedTotalCents, source: 'money_wins' },
    { label: 'Estimated Money Wins', amountCents: wins.estimatedTotalCents, source: 'money_wins' },
  ];
  if (topGoal) facts.push({ label: `${topGoal.name} remaining`, amountCents: topGoal.pacing.remainingAmountCents, source: 'goal' });
  return {
    answer: brief
      ? 'I found relevant account context, but I could not safely tailor it to that question just now.'
      : 'I need linked transaction history before I can answer that question from your actual spending.',
    facts,
    actions: [brief?.action.description ?? 'Link an account to generate your first brief.'],
  };
}

function mergeChatFacts(primary: ChatFactView[], extra: ChatFactView[]): ChatFactView[] {
  const seen = new Set<string>();
  return [...primary, ...extra].filter((fact) => {
    const key = `${fact.source}:${fact.label}:${fact.amountCents ?? 'null'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

function sourceForContextFact(kind: string): ChatFactView['source'] {
  if (kind === 'goal_remaining') return 'goal';
  if (kind === 'recurring_charge') return 'subscription_audit';
  return 'feature_rollup';
}

async function buildChatAnswer(userId: number, question: string): Promise<ChatAnswerView> {
  const deterministic =
    (await answerSubscriptionQuestion(userId, question)) ??
    (await answerAffordQuestion(userId, question)) ??
    (await answerBudgetQuestion(userId, question)) ??
    (await answerSpendingQuestion(userId, question)) ??
    (await answerGoalQuestion(userId, question)) ??
    (await answerGeneralQuestion(userId));

  let body = deterministic;
  try {
    const context = await assembleCoachingContext(db, userId, 'weekly_brief');
    const contextFacts: ChatFactView[] = context.facts.map((fact) => ({
      label: fact.label,
      amountCents: fact.amountCents,
      source: sourceForContextFact(fact.kind),
    }));
    const availableFacts = mergeChatFacts(deterministic.facts, contextFacts);
    body = await generateGroundedChatAnswer(question, deterministic, availableFacts, {
      weeksOfData: context.weeksOfData,
      recentWeeklyNetCents: context.profile.recentWeeklyNetCents,
      hasIncome: context.profile.hasIncome,
      goals: context.goals.map((goal) => ({
        name: goal.name,
        pacingStatus: goal.pacingStatus,
        remainingAmountCents: goal.remainingAmountCents,
        weeklyTargetCents: goal.weeklyTargetCents,
        targetDate: goal.targetDate,
        projectedCompletionDate: goal.projectedCompletionDate,
      })),
      categories: context.topDiscretionaryCategories.map((category) => ({
        label: category.label,
        amountCents: category.amountCents,
        deltaCents: category.deltaCents,
      })),
      recurringCharges: context.recurringCharges.map((charge) => ({
        merchant: charge.merchantClean,
        cadence: charge.cadence,
        avgAmountCents: charge.avgAmountCents,
      })),
      anomalies: context.anomalies.map((anomaly) => ({
        title: anomaly.title,
        amountCents: anomaly.amountCents,
      })),
    });
  } catch (err) {
    console.error('[chat] Anthropic response failed; using grounded deterministic answer:', safeErrorSummary(err));
  }

  const [saved] = await db
    .insert(chatMessages)
    .values({ userId, question, answer: body.answer, facts: body.facts, actions: body.actions })
    .returning();

  return {
    id: String(saved!.id),
    answer: body.answer,
    facts: body.facts,
    actions: body.actions,
    createdAt: saved!.createdAt.toISOString(),
  };
}

function projectionDate(remainingCents: number, weeklyNetCents: number): string | null {
  if (remainingCents <= 0) return isoDate(new Date());
  if (weeklyNetCents <= 0) return null;
  return isoDate(addDays(new Date(), Math.ceil(remainingCents / weeklyNetCents) * 7));
}

function weeksBetweenDates(later: string | null, earlier: string | null): number | null {
  if (!later || !earlier) return null;
  return Math.round((Date.parse(later) - Date.parse(earlier)) / 604800000);
}

async function runWhatIf(userId: number, input: WhatIfInput): Promise<WhatIfResultView> {
  const [weeklyNet, rows] = await Promise.all([
    getRecentWeeklyNetCents(db, userId),
    db
      .select()
      .from(goals)
      .where(input.goalId ? and(eq(goals.userId, userId), eq(goals.id, input.goalId)) : and(eq(goals.userId, userId), eq(goals.status, 'active')))
      .orderBy(asc(goals.priority), asc(goals.id)),
  ]);
  const weeklyNetChangeCents = Math.round((input.monthlySpendReductionCents + input.monthlyIncomeChangeCents) / 4.345);
  const simulatedWeeklyNet = weeklyNet + weeklyNetChangeCents;
  const projections: WhatIfGoalProjectionView[] = rows.map((goal) => {
    const current = computeGoalPacing(goal, weeklyNet);
    const simulatedRemaining = Math.max(0, current.remainingAmountCents - input.oneTimeSavingsCents);
    const simulated = projectionDate(simulatedRemaining, simulatedWeeklyNet);
    const faster = weeksBetweenDates(current.projectedCompletionDate, simulated);
    return {
      goalId: goal.id,
      name: goal.name,
      currentProjectedCompletionDate: current.projectedCompletionDate,
      simulatedProjectedCompletionDate: simulated,
      weeksFaster: faster === null ? null : Math.max(0, faster),
      remainingAmountCents: simulatedRemaining,
    };
  });
  const best = projections.find((p) => p.weeksFaster !== null && p.weeksFaster > 0);
  return {
    weeklyNetChangeCents,
    oneTimeSavingsCents: input.oneTimeSavingsCents,
    monthlySpendReductionCents: input.monthlySpendReductionCents,
    monthlyIncomeChangeCents: input.monthlyIncomeChangeCents,
    projections,
    narration: best
      ? `This scenario improves weekly cash flow by ${cents(weeklyNetChangeCents)} and could move ${best.name} up by about ${best.weeksFaster} week${
          best.weeksFaster === 1 ? '' : 's'
        }.`
      : `This scenario changes weekly cash flow by ${cents(weeklyNetChangeCents)}. Add or adjust a goal to see a timeline change.`,
  };
}

async function getNotificationPrefs(userId: number): Promise<NotificationPreferencesView> {
  const [prefs] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);
  const [token] = await db
    .select({ id: pushTokens.id })
    .from(pushTokens)
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.enabled, true)))
    .limit(1);
  return {
    weeklyBrief: prefs?.weeklyBrief ?? true,
    anomalies: prefs?.anomalies ?? true,
    goalPacing: prefs?.goalPacing ?? true,
    marketing: prefs?.marketing ?? false,
    pushEnabled: Boolean(token),
    updatedAt: (prefs?.updatedAt ?? new Date()).toISOString(),
  };
}

function streamAnswer(res: Response, answer: ChatAnswerView): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  for (const chunk of answer.answer.match(/.{1,80}(\s|$)/g) ?? [answer.answer]) {
    res.write(`event: chunk\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
  }
  res.write(`event: done\ndata: ${JSON.stringify(answer)}\n\n`);
  res.end();
}

export function createMobileRouter(): ReturnType<typeof Router> {
  const router = Router();

  router.get('/api/mobile/home', requireUser, async (_req, res) => {
    const userId = res.locals.userId as number;
    const [billing, zenScore, linked, txCount, firstLook, weeklyBrief, goalViews, subscriptionAudit, moneyWins, moneyPhysical, anomaliesList, txns] =
      await Promise.all([
        getBillingStatus(db, userId),
        computeZenScore(db, userId),
        linkedItems(userId),
        transactionCount(userId),
        latestInsight(userId, 'first_look'),
        latestInsight(userId, 'weekly_brief'),
        listGoals(userId),
        auditSubscriptions(db, userId),
        getMoneyWinsSummary(db, userId),
        getMoneyPhysicalStatus(db, userId),
        openAnomalies(userId),
        recentTransactions(userId, 12),
      ]);

    const body: MobileHomeSummaryView = {
      billing,
      zenScore,
      items: linked,
      transactionCount: txCount,
      firstLook,
      weeklyBrief,
      goals: goalViews,
      subscriptionAudit: billing.isPremium
        ? subscriptionAudit
        : { items: [], totalMonthlyCents: 0, cancelCandidateMonthlyCents: 0, cancelCandidateCount: 0 },
      moneyWins,
      moneyPhysical,
      openAnomalies: anomaliesList,
      recentTransactions: txns,
    };
    res.json(body);
  });

  router.post('/api/chat', requireUser, userRateLimit('chat', { windowMs: 60_000, limit: 10, message: 'Too many coach requests. Please wait a minute.' }), validateBody(chatQuestionSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    const premium = await assertPremium(db, userId, 'chat_coach');
    if (!premium.ok) {
      res.status(402).json(premium.payload);
      return;
    }
    const input = res.locals.body as { question: string };
    res.status(201).json(await buildChatAnswer(userId, input.question));
  });

  router.post('/api/chat/stream', requireUser, userRateLimit('chat-stream', { windowMs: 60_000, limit: 10, message: 'Too many coach requests. Please wait a minute.' }), validateBody(chatQuestionSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    const premium = await assertPremium(db, userId, 'chat_coach');
    if (!premium.ok) {
      res.status(402).json(premium.payload);
      return;
    }
    const input = res.locals.body as { question: string };
    streamAnswer(res, await buildChatAnswer(userId, input.question));
  });

  router.post('/api/what-if', requireUser, userRateLimit('what-if', { windowMs: 60_000, limit: 20, message: 'Too many scenario requests. Please wait a minute.' }), validateBody(whatIfSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    const premium = await assertPremium(db, userId, 'what_if');
    if (!premium.ok) {
      res.status(402).json(premium.payload);
      return;
    }
    res.json(await runWhatIf(userId, res.locals.body as WhatIfInput));
  });

  router.get('/api/notifications/preferences', requireUser, async (_req, res) => {
    res.json(await getNotificationPrefs(res.locals.userId as number));
  });

  router.patch(
    '/api/notifications/preferences',
    requireUser,
    validateBody(notificationPreferencesSchema),
    async (_req, res) => {
      const userId = res.locals.userId as number;
      const input = res.locals.body as NotificationPreferencesInput;
      await db
        .insert(notificationPreferences)
        .values({ userId, ...input, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: { ...input, updatedAt: new Date() },
        });
      res.json(await getNotificationPrefs(userId));
    },
  );

  router.post('/api/push-tokens', requireUser, userRateLimit('push-token', { windowMs: 60_000, limit: 10, message: 'Too many push registration attempts.' }), validateBody(pushTokenSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    const input = res.locals.body as PushTokenInput;
    await db
      .insert(pushTokens)
      .values({ userId, token: input.token, platform: input.platform, enabled: true, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: pushTokens.token,
        set: { userId, platform: input.platform, enabled: true, updatedAt: new Date() },
      });
    res.status(201).json(await getNotificationPrefs(userId));
  });

  router.delete('/api/push-tokens', requireUser, validateBody(pushTokenSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    const input = res.locals.body as PushTokenInput;
    await db
      .update(pushTokens)
      .set({ enabled: false, updatedAt: new Date() })
      .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, input.token)));
    res.status(204).end();
  });

  router.post('/api/app-events', requireUser, userRateLimit('app-events', { windowMs: 60_000, limit: 120, message: 'Too many analytics events.' }), validateBody(appEventSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    const input = res.locals.body as AppEventInput;
    await db.insert(appEvents).values({ userId, name: input.name, properties: input.properties });
    res.status(201).json({ ok: true });
  });

  return router;
}
