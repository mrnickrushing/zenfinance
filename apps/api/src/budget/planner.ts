import type {
  BudgetPlanBillView,
  BudgetPlanCategoryView,
  BudgetPlanInput,
  BudgetPlanStatus,
  BudgetPlanView,
  ChatFactView,
} from '@zenfinance/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { generateGroundedChatAnswer } from '../chat/anthropic.js';
import { auditSubscriptions } from '../coaching/subscriptions.js';
import type { Db } from '../db/client.js';
import { featureRollups, goals } from '../db/schema.js';
import { defaultDiscretionaryFor, labelFor, NON_SPEND_CATEGORIES } from '../enrichment/categories.js';
import { env } from '../env.js';
import { safeErrorSummary } from '../lib/safeError.js';

const MONTHS_PER_WEEK = 52 / 12;
// Match the 90-day Plaid history closely enough to capture monthly and
// irregular pay cycles without letting old income dominate the plan.
const MAX_WEEKS = 12;

export type AllocationInput = { category: string; baselineCents: number };

function cents(amount: number): string {
  return `$${(Math.abs(amount) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function currentMonthStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function allocateProportionally(entries: AllocationInput[], capacityCents: number): Map<string, number> {
  const result = new Map(entries.map((entry) => [entry.category, 0]));
  const total = entries.reduce((sum, entry) => sum + entry.baselineCents, 0);
  const target = Math.min(Math.max(0, capacityCents), total);
  if (target === 0 || total === 0) return result;

  for (const entry of entries) {
    result.set(entry.category, Math.floor((entry.baselineCents / total) * target));
  }
  let remaining = target - [...result.values()].reduce((sum, amount) => sum + amount, 0);
  for (let index = entries.length - 1; index >= 0 && remaining > 0; index--) {
    const entry = entries[index]!;
    const allocation = result.get(entry.category) ?? 0;
    const roundedRemainder = Math.min(remaining, entry.baselineCents - allocation);
    result.set(entry.category, allocation + roundedRemainder);
    remaining -= roundedRemainder;
  }
  return result;
}

export function isBudgetBillCategory(category: string | null): boolean {
  return category === null || !NON_SPEND_CATEGORIES.has(category);
}

function deterministicExplanation(
  status: BudgetPlanStatus,
  goalName: string,
  savingsCents: number,
  incomeCents: number,
  billsCents: number,
  billCount: number,
  spendingCents: number,
  bufferCents: number,
  shortfallCents: number,
  detectedBillCount: number,
  allDetectedBillsIncluded: boolean,
  adjustmentCount: number,
): { answer: string; actions: string[] } {
  const coverage = allDetectedBillsIncluded
    ? `all ${detectedBillCount} detected recurring bill${detectedBillCount === 1 ? '' : 's'}`
    : `${billCount} included bill${billCount === 1 ? '' : 's'} after your exclusions`;
  const adjustmentNote = adjustmentCount > 0 ? ` using ${adjustmentCount} custom value${adjustmentCount === 1 ? '' : 's'}` : '';
  if (status === 'needs_income') {
    return {
      answer: `I included ${coverage}, but I need recent linked income or a monthly income amount before I can build a safe plan for ${goalName}.`,
      actions: ['Sync the account that receives income, then build the plan again.', 'Review the detected bill list for anything missing.'],
    };
  }
  if (status === 'shortfall') {
    return {
      answer: `Saving ${cents(savingsCents)} toward ${goalName} while covering ${coverage} (${cents(billsCents)}) and the spending limits you set${adjustmentNote} requires ${cents(shortfallCents)} more than monthly income of ${cents(incomeCents)}.`,
      actions: ['Lower this month\'s savings, reduce essential costs, or review recurring bills.', 'Do not apply a plan until the shortfall is resolved.'],
    };
  }
  return {
    answer: `This plan covers ${coverage}, puts ${cents(savingsCents)} toward ${goalName}, allows ${cents(spendingCents)} for monthly spending, and keeps ${cents(bufferCents)} unassigned${adjustmentNote}.`,
    actions: [
      'Review every included bill and suggested category cap.',
      'Apply the plan only when the amounts look right; no money will move.',
    ],
  };
}

export async function buildBudgetPlan(db: Db, userId: number, input: BudgetPlanInput): Promise<BudgetPlanView | null> {
  const [goalRows, rollups, subscriptionAudit] = await Promise.all([
    db.select().from(goals).where(and(eq(goals.userId, userId), eq(goals.id, input.goalId), eq(goals.status, 'active'))).limit(1),
    db
      .select({
        weekStart: featureRollups.weekStart,
        metric: featureRollups.metric,
        category: featureRollups.category,
        valueCents: featureRollups.valueCents,
      })
      .from(featureRollups)
      .where(
        and(
          eq(featureRollups.userId, userId),
          inArray(featureRollups.metric, ['income_total', 'category_spend']),
        ),
      ),
    auditSubscriptions(db, userId),
  ]);
  const goal = goalRows[0];
  if (!goal) return null;

  const weeks = [...new Set(rollups.map((row) => row.weekStart))].sort().reverse().slice(0, MAX_WEEKS);
  const selectedWeekSet = new Set(weeks);
  const selectedRollups = rollups.filter((row) => selectedWeekSet.has(row.weekStart));
  const weekCount = weeks.length;
  const incomeRows = selectedRollups.filter((row) => row.metric === 'income_total');
  const incomeTotal = incomeRows
    .reduce((sum, row) => sum + Math.max(0, row.valueCents ?? 0), 0);
  const detectedMonthlyIncomeCents = weekCount > 0 ? Math.round((incomeTotal / weekCount) * MONTHS_PER_WEEK) : 0;
  const incomeSource = input.monthlyIncomeOverrideCents === undefined ? 'detected' : 'user';
  const monthlyIncomeCents = input.monthlyIncomeOverrideCents ?? detectedMonthlyIncomeCents;

  const historicalByCategory = new Map<string, number>();
  for (const row of selectedRollups) {
    if (row.metric !== 'category_spend' || row.category === '_total') continue;
    historicalByCategory.set(row.category, (historicalByCategory.get(row.category) ?? 0) + Math.max(0, row.valueCents ?? 0));
  }
  if (weekCount > 0) {
    for (const [category, total] of historicalByCategory) {
      historicalByCategory.set(category, Math.round((total / weekCount) * MONTHS_PER_WEEK));
    }
  }

  const detectedBills = subscriptionAudit.items.filter((bill) => isBudgetBillCategory(bill.category));
  const billOverrideMap = new Map((input.billOverrides ?? []).map((override) => [override.recurringStreamId, override]));
  const resolvedDetectedBills: BudgetPlanBillView[] = detectedBills.map((bill) => {
    const override = billOverrideMap.get(bill.recurringStreamId);
    const monthlyEquivalentCents = override?.monthlyEquivalentCents ?? bill.monthlyEquivalentCents;
    const included = override?.included ?? true;
    return {
      recurringStreamId: bill.recurringStreamId,
      clientId: `detected-${bill.recurringStreamId}`,
      merchantClean: bill.merchantClean,
      cadence: bill.cadence,
      category: bill.category,
      monthlyEquivalentCents,
      detectedMonthlyEquivalentCents: bill.monthlyEquivalentCents,
      nextExpectedDate: bill.nextExpectedDate,
      isAdjustable: bill.isCancelCandidate,
      included,
      source: 'detected',
      userAdjusted: included !== true || monthlyEquivalentCents !== bill.monthlyEquivalentCents,
    };
  });
  const customBills: BudgetPlanBillView[] = (input.customBills ?? []).map((bill) => ({
    recurringStreamId: null,
    clientId: bill.clientId,
    merchantClean: bill.merchantClean,
    cadence: bill.cadence,
    category: bill.category ?? null,
    monthlyEquivalentCents: bill.monthlyEquivalentCents,
    detectedMonthlyEquivalentCents: null,
    nextExpectedDate: null,
    isAdjustable: true,
    included: true,
    source: 'user',
    userAdjusted: true,
  }));
  const bills = [...resolvedDetectedBills, ...customBills];
  const includedBills = bills.filter((bill) => bill.included);
  const detectedRecurringByCategory = new Map<string, number>();
  for (const bill of detectedBills) {
    if (!bill.category) continue;
    detectedRecurringByCategory.set(bill.category, (detectedRecurringByCategory.get(bill.category) ?? 0) + bill.monthlyEquivalentCents);
  }
  const billsByCategory = new Map<string, number>();
  for (const bill of includedBills) {
    if (!bill.category) continue;
    billsByCategory.set(bill.category, (billsByCategory.get(bill.category) ?? 0) + bill.monthlyEquivalentCents);
  }
  const categoryOverrideMap = new Map((input.categoryOverrides ?? []).map((override) => [override.category, override.recommendedCents]));
  const allCategories = new Set([...historicalByCategory.keys(), ...billsByCategory.keys(), ...categoryOverrideMap.keys()]);
  const baselines = [...allCategories].map((category) => {
    const historicalMonthlyCents = historicalByCategory.get(category) ?? 0;
    const recurringMonthlyCents = billsByCategory.get(category) ?? 0;
    return {
      category,
      historicalMonthlyCents,
      recurringMonthlyCents,
      flexibleBaselineCents: Math.max(0, historicalMonthlyCents - (detectedRecurringByCategory.get(category) ?? 0)),
      isDiscretionary: defaultDiscretionaryFor(category),
    };
  });

  const remainingAmountCents = Math.max(0, goal.targetAmountCents - goal.currentAmountCents);
  const plannedSavingsCents = Math.min(input.monthlySavingsCents, remainingAmountCents);
  const billsTotalCents = includedBills.reduce((sum, bill) => sum + bill.monthlyEquivalentCents, 0);
  const rawAvailableCents = monthlyIncomeCents - plannedSavingsCents - billsTotalCents;
  const hasDetectedIncomeData = incomeRows.length > 0;
  const hasIncomeData = hasDetectedIncomeData || input.monthlyIncomeOverrideCents !== undefined;
  const targetBufferCents = input.targetBufferCents ?? 0;

  const essentialInputs = baselines
    .filter((entry) => !entry.isDiscretionary && entry.flexibleBaselineCents > 0)
    .map((entry) => ({ category: entry.category, baselineCents: entry.flexibleBaselineCents }));
  const discretionaryInputs = baselines
    .filter((entry) => entry.isDiscretionary && entry.flexibleBaselineCents > 0)
    .map((entry) => ({ category: entry.category, baselineCents: entry.flexibleBaselineCents }));
  const availableForFlexibleCents = hasIncomeData ? Math.max(0, rawAvailableCents - targetBufferCents) : 0;
  const essentialAllocation = allocateProportionally(essentialInputs, availableForFlexibleCents);
  const essentialAllocatedCents = [...essentialAllocation.values()].reduce((sum, amount) => sum + amount, 0);
  const discretionaryAllocation = allocateProportionally(discretionaryInputs, availableForFlexibleCents - essentialAllocatedCents);
  const flexibleSpendingCents = essentialAllocatedCents + [...discretionaryAllocation.values()].reduce((sum, amount) => sum + amount, 0);
  const flexibleBaselineTotalCents = baselines.reduce((sum, entry) => sum + entry.flexibleBaselineCents, 0);

  const categories: BudgetPlanCategoryView[] = baselines
    .map((entry) => {
      const flexibleRecommendedCents = entry.isDiscretionary
        ? discretionaryAllocation.get(entry.category) ?? 0
        : essentialAllocation.get(entry.category) ?? 0;
      const baselineRecommendedCents = entry.recurringMonthlyCents + flexibleRecommendedCents;
      const overrideCents = categoryOverrideMap.get(entry.category);
      const recommendedCents = overrideCents === undefined
        ? baselineRecommendedCents
        : Math.max(entry.recurringMonthlyCents, overrideCents);
      return {
        category: entry.category,
        label: labelFor(entry.category),
        historicalMonthlyCents: entry.historicalMonthlyCents,
        recurringMonthlyCents: entry.recurringMonthlyCents,
        recommendedCents,
        baselineRecommendedCents,
        adjustmentCents: recommendedCents - entry.historicalMonthlyCents,
        isDiscretionary: entry.isDiscretionary,
        userAdjusted: overrideCents !== undefined && recommendedCents !== baselineRecommendedCents,
      };
    })
    .filter((entry) => entry.historicalMonthlyCents > 0 || entry.recommendedCents > 0)
    .sort((a, b) => b.recommendedCents - a.recommendedCents);

  const uncategorizedBillsCents = includedBills
    .filter((bill) => !bill.category)
    .reduce((sum, bill) => sum + bill.monthlyEquivalentCents, 0);
  const recommendedSpendingCents = uncategorizedBillsCents + categories.reduce((sum, category) => sum + category.recommendedCents, 0);
  const adjustedFlexibleSpendingCents = Math.max(0, recommendedSpendingCents - billsTotalCents);
  const essentialFlexibleCents = baselines
    .filter((entry) => !entry.isDiscretionary)
    .reduce((sum, entry) => {
      const overrideCents = categoryOverrideMap.get(entry.category);
      return sum + (overrideCents === undefined
        ? entry.flexibleBaselineCents
        : Math.max(0, overrideCents - entry.recurringMonthlyCents));
    }, 0);
  const essentialShortfallCents = hasIncomeData
    ? Math.max(0, plannedSavingsCents + billsTotalCents + essentialFlexibleCents + targetBufferCents - monthlyIncomeCents)
    : 0;
  const planShortfallCents = hasIncomeData
    ? Math.max(0, plannedSavingsCents + recommendedSpendingCents + targetBufferCents - monthlyIncomeCents)
    : 0;
  const shortfallCents = Math.max(essentialShortfallCents, planShortfallCents);
  const bufferCents = hasIncomeData
    ? Math.max(0, monthlyIncomeCents - plannedSavingsCents - recommendedSpendingCents)
    : 0;
  let status: BudgetPlanStatus;
  if (!hasIncomeData) status = 'needs_income';
  else if (shortfallCents > 0) status = 'shortfall';
  else if (adjustedFlexibleSpendingCents < flexibleBaselineTotalCents || bufferCents < targetBufferCents) status = 'tight';
  else status = 'ready';
  const billOverrideCount = resolvedDetectedBills.filter((bill) => bill.userAdjusted).length;
  const categoryOverrideCount = categories.filter((category) => category.userAdjusted).length;
  const adjustmentCount = (incomeSource === 'user' ? 1 : 0) + billOverrideCount + customBills.length + categoryOverrideCount + (targetBufferCents > 0 ? 1 : 0);
  const allDetectedBillsIncluded = resolvedDetectedBills.every((bill) => bill.included);
  const deterministic = deterministicExplanation(
    status,
    goal.name,
    plannedSavingsCents,
    monthlyIncomeCents,
    billsTotalCents,
    includedBills.length,
    recommendedSpendingCents,
    bufferCents,
    shortfallCents,
    detectedBills.length,
    allDetectedBillsIncluded,
    adjustmentCount,
  );
  const facts: ChatFactView[] = [
    { label: incomeSource === 'user' ? 'User-entered monthly income' : 'Modeled monthly income', amountCents: monthlyIncomeCents, source: incomeSource === 'user' ? 'user_input' : 'feature_rollup' },
    { label: allDetectedBillsIncluded ? 'All detected recurring bills per month' : 'Included recurring bills per month', amountCents: billsTotalCents, source: billOverrideCount > 0 || customBills.length > 0 ? 'user_input' : 'subscription_audit' },
    { label: `Planned monthly savings for ${goal.name}`, amountCents: plannedSavingsCents, source: 'goal' },
    { label: 'Recommended monthly spending', amountCents: recommendedSpendingCents, source: categoryOverrideCount > 0 ? 'user_input' : 'transaction_query' },
    { label: 'Unassigned monthly buffer', amountCents: bufferCents, source: targetBufferCents > 0 ? 'user_input' : 'transaction_query' },
  ];
  if (shortfallCents > 0) facts.push({ label: 'Monthly plan shortfall', amountCents: shortfallCents, source: 'transaction_query' });

  let explanation = deterministic.answer;
  let actions = deterministic.actions;
  let explanationSource: BudgetPlanView['explanationSource'] = 'deterministic';
  try {
    const generated = await generateGroundedChatAnswer(
      'Explain this monthly budget plan. Accurately state whether every detected recurring bill is included or whether the user excluded one, identify user-entered assumptions, explain the savings-goal tradeoff, and do not change any server-computed numbers.',
      { answer: deterministic.answer, facts, actions: deterministic.actions },
      facts,
      {
        status,
        planMonth: input.planMonth ?? currentMonthStart(),
        billCount: includedBills.length,
        detectedBillCount: detectedBills.length,
        allDetectedBillsIncluded,
        bills: bills.map((bill) => ({ merchant: bill.merchantClean, monthlyEquivalentCents: bill.monthlyEquivalentCents, included: bill.included, source: bill.source })),
        categories: categories.map((category) => ({ category: category.category, recommendedCents: category.recommendedCents })),
        adjustments: { incomeSource, targetBufferCents, billOverrideCount, customBillCount: customBills.length, categoryOverrideCount },
      },
    );
    explanation = generated.answer;
    actions = generated.actions;
    if (env.CHAT_PROVIDER === 'anthropic') explanationSource = 'anthropic';
  } catch (error) {
    console.error('[budget-plan] Anthropic explanation failed; using deterministic explanation:', safeErrorSummary(error));
  }

  return {
    planMonth: input.planMonth ?? currentMonthStart(),
    status,
    goal: {
      id: goal.id,
      name: goal.name,
      remainingAmountCents,
      requestedSavingsCents: input.monthlySavingsCents,
      plannedSavingsCents,
    },
    monthlyIncomeCents,
    recurringBillsTotalCents: billsTotalCents,
    availableAfterGoalAndBillsCents: Math.max(0, rawAvailableCents),
    recommendedSpendingCents,
    flexibleSpendingCents: adjustedFlexibleSpendingCents,
    bufferCents,
    shortfallCents,
    bills,
    categories,
    dataCoverage: {
      weeksAnalyzed: weekCount,
      detectedBillCount: detectedBills.length,
      includedBillCount: includedBills.length,
      customBillCount: customBills.length,
      allDetectedBillsIncluded,
      uncategorizedBillCount: includedBills.filter((bill) => !bill.category).length,
      hasIncomeData,
      hasDetectedIncomeData,
    },
    adjustments: {
      detectedMonthlyIncomeCents,
      incomeSource,
      targetBufferCents,
      billOverrideCount,
      customBillCount: customBills.length,
      categoryOverrideCount,
    },
    explanation,
    explanationSource,
    actions,
  };
}
