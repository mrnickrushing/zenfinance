import {
  MONEY_PHYSICAL_PRODUCT_ID,
  type MoneyPhysicalActionView,
  type MoneyPhysicalCategoryBreakdown,
  type MoneyPhysicalReportSectionsView,
  type MoneyPhysicalReportView,
  type MoneyPhysicalRestoreInput,
  type MoneyPhysicalStatusView,
} from '@zenfinance/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  accounts,
  appEvents,
  goals,
  items,
  moneyPhysicalReports,
  transactionEnrichments,
  transactions,
} from '../db/schema.js';
import { env } from '../env.js';
import { auditSubscriptions } from '../coaching/subscriptions.js';
import { computeGoalPacing, type Goal } from '../coaching/goals.js';
import { getMoneyWinsSummary } from '../coaching/moneyWins.js';
import { getRecentWeeklyNetCents } from '../features/rollup.js';
import { isIncomeTransaction, spendingContribution } from '../finance/classify.js';

type PurchaseSource = 'revenuecat_webhook' | 'client_restore' | 'manual_test';

interface MoneyPhysicalPurchase {
  productId: string;
  transactionId: string;
  store: string | null;
  environment: 'SANDBOX' | 'PRODUCTION' | 'UNKNOWN';
  purchasedAt: Date;
  purchaseSource: PurchaseSource;
  rawPayload: unknown;
}

interface ReportTransaction {
  amountCents: number;
  postedDate: string;
  name: string;
  merchantName: string | null;
  category: string | null;
  providerCategory: string | null;
  merchantClean: string | null;
}

interface RevenueCatNonSubscription {
  id?: string;
  transaction_id?: string;
  original_transaction_id?: string;
  product_identifier?: string;
  purchase_date?: string;
  store?: string;
  is_sandbox?: boolean;
}

const REPORT_WINDOW_DAYS = 90;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function dollars(cents: number): string {
  return `$${Math.abs(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function categoryLabel(category: string): string {
  return category
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function reportToView(row: typeof moneyPhysicalReports.$inferSelect): MoneyPhysicalReportView {
  return {
    id: row.id,
    productId: row.productId,
    transactionId: row.transactionId,
    store: row.store,
    environment: row.environment === 'SANDBOX' || row.environment === 'PRODUCTION' ? row.environment : 'UNKNOWN',
    purchasedAt: row.purchasedAt.toISOString(),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    score: row.score,
    headline: row.headline,
    summary: row.summary,
    sections: row.sections as MoneyPhysicalReportSectionsView,
    actions: row.actions as MoneyPhysicalActionView[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function userAccountIds(db: Db, userId: number): Promise<number[]> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .innerJoin(items, eq(accounts.itemId, items.id))
    .where(eq(items.userId, userId));
  return rows.map((row) => row.id);
}

async function reportWindow(db: Db, accountIds: number[]): Promise<{ start: string; end: string }> {
  if (accountIds.length === 0) {
    const end = new Date();
    return { start: isoDate(addDays(end, -(REPORT_WINDOW_DAYS - 1))), end: isoDate(end) };
  }
  const [latest] = await db
    .select({ postedDate: transactions.postedDate })
    .from(transactions)
    .where(and(inArray(transactions.accountId, accountIds), isNull(transactions.removedAt), isNull(transactions.supersededAt)))
    .orderBy(desc(transactions.postedDate))
    .limit(1);
  const end = latest ? new Date(`${latest.postedDate}T00:00:00.000Z`) : new Date();
  return { start: isoDate(addDays(end, -(REPORT_WINDOW_DAYS - 1))), end: isoDate(end) };
}

async function reportTransactions(db: Db, accountIds: number[], start: string, end: string): Promise<ReportTransaction[]> {
  if (accountIds.length === 0) return [];
  return db
    .select({
      amountCents: transactions.amountCents,
      postedDate: transactions.postedDate,
      name: transactions.name,
      merchantName: transactions.merchantName,
      category: transactionEnrichments.category,
      providerCategory: transactions.providerCategory,
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
        isNull(transactions.transferPairId),
        eq(transactions.pending, false),
        sql`${transactions.postedDate} >= ${start}`,
        sql`${transactions.postedDate} <= ${end}`,
      ),
    )
    .orderBy(desc(transactions.postedDate), desc(transactions.id));
}

function topCategories(txns: ReportTransaction[], spendingCents: number): MoneyPhysicalCategoryBreakdown[] {
  const byCategory = new Map<string, { amountCents: number; transactionCount: number }>();
  for (const txn of txns) {
    const contribution = spendingContribution(txn);
    if (contribution === 0) continue;
    const category = txn.category ?? 'uncategorized';
    const current = byCategory.get(category) ?? { amountCents: 0, transactionCount: 0 };
    current.amountCents += contribution;
    current.transactionCount += 1;
    byCategory.set(category, current);
  }
  return [...byCategory.entries()]
    .filter(([, value]) => value.amountCents > 0)
    .map(([category, value]) => ({
      category,
      amountCents: value.amountCents,
      transactionCount: value.transactionCount,
      shareOfSpend: spendingCents > 0 ? Number((value.amountCents / spendingCents).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 5);
}

async function goalSection(db: Db, userId: number): Promise<MoneyPhysicalReportSectionsView['goals']> {
  const [weeklyNet, goalRows] = await Promise.all([
    getRecentWeeklyNetCents(db, userId),
    db.select().from(goals).where(and(eq(goals.userId, userId), eq(goals.status, 'active'))).orderBy(asc(goals.priority), asc(goals.id)),
  ]);
  let behindGoals = 0;
  let remainingCents = 0;
  for (const goal of goalRows as Goal[]) {
    const pacing = computeGoalPacing(goal, weeklyNet);
    if (pacing.pacingStatus === 'behind') behindGoals += 1;
    remainingCents += pacing.remainingAmountCents;
  }
  return { activeGoals: goalRows.length, behindGoals, remainingCents };
}

function scoreReport(sections: MoneyPhysicalReportSectionsView): number {
  let score = 70;
  const savingsRate = sections.cashFlow.savingsRate;
  if (sections.cashFlow.incomeCents === 0 && sections.cashFlow.spendingCents === 0) score = 50;
  if (savingsRate !== null) {
    if (savingsRate >= 0.2) score += 12;
    else if (savingsRate >= 0.05) score += 6;
    else if (savingsRate < 0) score -= 18;
    else score -= 4;
  }
  const recurringBurden =
    sections.cashFlow.incomeCents > 0 ? sections.recurring.totalMonthlyCents / Math.max(1, sections.cashFlow.incomeCents / 3) : 0;
  if (recurringBurden > 0.35) score -= 10;
  else if (recurringBurden > 0.2) score -= 5;
  score -= Math.min(15, sections.goals.behindGoals * 5);
  if (sections.goals.activeGoals === 0) score -= 4;
  if (sections.wins.verifiedTotalCents > 0) score += 5;
  if (sections.recurring.cancelCandidateMonthlyCents > 0) score -= 4;
  return clampScore(score);
}

function actionPlan(sections: MoneyPhysicalReportSectionsView): MoneyPhysicalActionView[] {
  const actions: MoneyPhysicalActionView[] = [];
  const top = sections.spending.topCategories[0];
  if (top && top.amountCents >= 10_000) {
    const impact = Math.round(top.amountCents * 0.1);
    actions.push({
      title: `Trim ${categoryLabel(top.category)} by 10%`,
      detail: `This was your largest 90-day spend area at ${dollars(top.amountCents)}. A small trim would free about ${dollars(impact)} next cycle.`,
      estimatedImpactCents: impact,
    });
  }
  if (sections.recurring.cancelCandidateMonthlyCents > 0) {
    actions.push({
      title: 'Review one recurring charge',
      detail: `${dollars(sections.recurring.cancelCandidateMonthlyCents)} per month is flagged as likely cancellable or worth renegotiating.`,
      estimatedImpactCents: sections.recurring.cancelCandidateMonthlyCents,
    });
  }
  if (sections.goals.behindGoals > 0) {
    actions.push({
      title: 'Reset goal pacing this week',
      detail: `${sections.goals.behindGoals} active goal${sections.goals.behindGoals === 1 ? ' is' : 's are'} behind. Move one deadline or add a smaller weekly transfer.`,
      estimatedImpactCents: null,
    });
  }
  if (actions.length === 0) {
    actions.push({
      title: 'Keep the 90-day checkup cadence',
      detail: 'Your current profile does not show a high-confidence emergency action. Re-run the Money Physical after another full spending cycle.',
      estimatedImpactCents: null,
    });
  }
  return actions.slice(0, 3);
}

async function buildReport(db: Db, userId: number, purchase: MoneyPhysicalPurchase): Promise<Omit<MoneyPhysicalReportView, 'id' | 'createdAt' | 'updatedAt'>> {
  const accountIds = await userAccountIds(db, userId);
  const window = await reportWindow(db, accountIds);
  const [txns, goalStats, recurring, wins] = await Promise.all([
    reportTransactions(db, accountIds, window.start, window.end),
    goalSection(db, userId),
    auditSubscriptions(db, userId),
    getMoneyWinsSummary(db, userId),
  ]);

  const incomeCents = txns.filter(isIncomeTransaction).reduce((sum, txn) => sum + Math.abs(txn.amountCents), 0);
  const spendingCents = Math.max(0, txns.reduce((sum, txn) => sum + spendingContribution(txn), 0));
  const netCashFlowCents = incomeCents - spendingCents;
  const sections: MoneyPhysicalReportSectionsView = {
    cashFlow: {
      incomeCents,
      spendingCents,
      netCashFlowCents,
      savingsRate: incomeCents > 0 ? Number((netCashFlowCents / incomeCents).toFixed(4)) : null,
    },
    spending: {
      topCategories: topCategories(txns, spendingCents),
      largestTransactionCents: txns.map(spendingContribution).filter((amount) => amount > 0).sort((a, b) => b - a)[0] ?? null,
    },
    goals: goalStats,
    recurring: {
      totalMonthlyCents: recurring.totalMonthlyCents,
      cancelCandidateMonthlyCents: recurring.cancelCandidateMonthlyCents,
      cancelCandidateCount: recurring.cancelCandidateCount,
    },
    wins: {
      verifiedTotalCents: wins.verifiedTotalCents,
      estimatedTotalCents: wins.estimatedTotalCents,
    },
  };
  const score = scoreReport(sections);
  const actions = actionPlan(sections);
  const headline =
    score >= 80
      ? 'Your money system is in strong shape'
      : score >= 60
        ? 'Your money system has a few high-leverage tuneups'
        : 'Your money system needs a focused reset';
  const summary =
    txns.length === 0
      ? 'This Money Physical is ready, but it needs linked transaction history to produce a useful 90-day read.'
      : `In the last ${REPORT_WINDOW_DAYS} days, income was ${dollars(incomeCents)}, spending was ${dollars(
          spendingCents,
        )}, and net cash flow was ${netCashFlowCents >= 0 ? dollars(netCashFlowCents) : `-${dollars(netCashFlowCents)}`}.`;

  return {
    productId: purchase.productId,
    transactionId: purchase.transactionId,
    store: purchase.store,
    environment: purchase.environment,
    purchasedAt: purchase.purchasedAt.toISOString(),
    periodStart: window.start,
    periodEnd: window.end,
    score,
    headline,
    summary,
    sections,
    actions,
  };
}

export async function latestMoneyPhysicalReport(db: Db, userId: number): Promise<MoneyPhysicalReportView | null> {
  const [row] = await db
    .select()
    .from(moneyPhysicalReports)
    .where(eq(moneyPhysicalReports.userId, userId))
    .orderBy(desc(moneyPhysicalReports.createdAt))
    .limit(1);
  return row ? reportToView(row) : null;
}

export async function moneyPhysicalReportsForExport(db: Db, userId: number): Promise<MoneyPhysicalReportView[]> {
  const rows = await db
    .select()
    .from(moneyPhysicalReports)
    .where(eq(moneyPhysicalReports.userId, userId))
    .orderBy(desc(moneyPhysicalReports.createdAt));
  return rows.map(reportToView);
}

export async function getMoneyPhysicalStatus(db: Db, userId: number): Promise<MoneyPhysicalStatusView> {
  const latestReport = await latestMoneyPhysicalReport(db, userId);
  return {
    productId: MONEY_PHYSICAL_PRODUCT_ID,
    priceLabel: '$14.99',
    purchased: Boolean(latestReport),
    latestPurchaseAt: latestReport?.purchasedAt ?? null,
    latestReport,
  };
}

export async function validateMoneyPhysicalRevenueCatPurchase(
  appUserId: string,
  transactionId: string,
): Promise<Omit<MoneyPhysicalRestoreInput, 'appUserId'> | null> {
  if (!env.REVENUECAT_SECRET_API_KEY) return null;
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: {
      Authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`RevenueCat subscriber refresh failed (${res.status})`);
  }
  const body = (await res.json()) as {
    subscriber?: {
      non_subscriptions?: Record<string, RevenueCatNonSubscription[]>;
    };
  };
  const productPurchases = body.subscriber?.non_subscriptions?.[MONEY_PHYSICAL_PRODUCT_ID] ?? [];
  const purchase = productPurchases.find((item) =>
    [item.id, item.transaction_id, item.original_transaction_id].filter(Boolean).includes(transactionId),
  );
  if (!purchase) return null;
  return {
    productId: MONEY_PHYSICAL_PRODUCT_ID,
    transactionId: purchase.id ?? purchase.transaction_id ?? purchase.original_transaction_id ?? transactionId,
    purchaseDate: purchase.purchase_date ?? null,
    store: purchase.store?.toUpperCase(),
    environment: purchase.is_sandbox === true ? 'SANDBOX' : purchase.is_sandbox === false ? 'PRODUCTION' : 'UNKNOWN',
  };
}

export async function recordMoneyPhysicalPurchase(
  db: Db,
  userId: number,
  input: MoneyPhysicalRestoreInput | MoneyPhysicalPurchase,
  purchaseSource: PurchaseSource = 'client_restore',
  rawPayload: unknown = input,
): Promise<MoneyPhysicalReportView> {
  const purchase: MoneyPhysicalPurchase = {
    productId: input.productId,
    transactionId: input.transactionId,
    store: input.store ?? null,
    environment: input.environment,
    purchasedAt:
      'purchasedAt' in input
        ? input.purchasedAt
        : input.purchaseDate
          ? new Date(input.purchaseDate)
          : new Date(),
    purchaseSource: 'purchaseSource' in input ? input.purchaseSource : purchaseSource,
    rawPayload: 'rawPayload' in input ? input.rawPayload : rawPayload,
  };
  if (purchase.productId !== MONEY_PHYSICAL_PRODUCT_ID) {
    throw new Error('Money Physical product id does not match');
  }

  const report = await buildReport(db, userId, purchase);
  const [inserted] = await db
    .insert(moneyPhysicalReports)
    .values({
      userId,
      productId: report.productId,
      transactionId: report.transactionId,
      store: report.store,
      environment: report.environment,
      purchaseSource: purchase.purchaseSource,
      purchasedAt: purchase.purchasedAt,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      score: report.score,
      headline: report.headline,
      summary: report.summary,
      sections: report.sections,
      actions: report.actions,
      rawPayload: purchase.rawPayload,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: moneyPhysicalReports.transactionId })
    .returning();
  if (inserted) {
    await db.insert(appEvents).values({
      userId,
      name: 'money_physical:generated',
      properties: { reportId: inserted.id, productId: report.productId, score: report.score },
    });
    return reportToView(inserted);
  }

  const [existing] = await db
    .select()
    .from(moneyPhysicalReports)
    .where(and(eq(moneyPhysicalReports.userId, userId), eq(moneyPhysicalReports.transactionId, purchase.transactionId)))
    .limit(1);
  if (!existing) throw new Error('Money Physical purchase belongs to a different user');
  return reportToView(existing);
}
