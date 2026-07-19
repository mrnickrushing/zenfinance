import type { BudgetPlanView } from '@zenfinance/shared';
import { describe, expect, it } from 'vitest';
import {
  appliedBudgetTarget,
  appliedCategoryCaps,
  buildBudgetPlanRequest,
  canApplyBudgetPlan,
} from './budgetPlan.js';

function plan(status: BudgetPlanView['status']): BudgetPlanView {
  return {
    planMonth: '2026-07-01',
    status,
    goal: { id: 4, name: 'Emergency fund', remainingAmountCents: 200000, requestedSavingsCents: 50000, plannedSavingsCents: 50000 },
    monthlyIncomeCents: 400000,
    recurringBillsTotalCents: 150000,
    availableAfterGoalAndBillsCents: 200000,
    recommendedSpendingCents: 330025,
    flexibleSpendingCents: 180025,
    bufferCents: 19975,
    shortfallCents: 0,
    bills: [],
    categories: [
      { category: 'GROCERIES', label: 'Groceries', historicalMonthlyCents: 51000, recurringMonthlyCents: 0, recommendedCents: 50125, baselineRecommendedCents: 50125, adjustmentCents: -875, isDiscretionary: false, userAdjusted: false },
      { category: 'COFFEE_SHOPS', label: 'Coffee Shops', historicalMonthlyCents: 1900, recurringMonthlyCents: 0, recommendedCents: 0, baselineRecommendedCents: 0, adjustmentCents: -1900, isDiscretionary: true, userAdjusted: false },
    ],
    dataCoverage: { weeksAnalyzed: 8, detectedBillCount: 2, includedBillCount: 2, customBillCount: 0, allDetectedBillsIncluded: true, uncategorizedBillCount: 0, hasIncomeData: true, hasDetectedIncomeData: true },
    adjustments: { detectedMonthlyIncomeCents: 400000, incomeSource: 'detected', targetBufferCents: 0, billOverrideCount: 0, customBillCount: 0, categoryOverrideCount: 0 },
    explanation: 'A grounded plan.',
    explanationSource: 'deterministic',
    actions: ['Review it.'],
  };
}

describe('AI monthly budget plan', () => {
  it('builds a current-local-month request from a flexible currency input', () => {
    expect(buildBudgetPlanRequest(4, '$1,250.50', new Date(2026, 6, 18, 12))).toEqual({
      ok: true,
      value: { goalId: 4, monthlySavingsCents: 125050, planMonth: '2026-07-01' },
    });
  });

  it('rejects missing goals and invalid savings amounts', () => {
    expect(buildBudgetPlanRequest(null, '500')).toEqual({ ok: false, error: 'Choose a savings goal first.' });
    expect(buildBudgetPlanRequest(4, '')).toEqual({ ok: false, error: 'Enter monthly savings.' });
    expect(buildBudgetPlanRequest(4, '-20').ok).toBe(false);
    expect(buildBudgetPlanRequest(4, '100000.01').ok).toBe(false);
  });

  it('parses user-controlled income, bills, category caps, and buffer assumptions', () => {
    expect(buildBudgetPlanRequest(4, '800', new Date(2026, 6, 18, 12), {
      monthlyIncome: '$5,420',
      billOverrides: [{ recurringStreamId: 9, included: false, monthlyAmount: '20' }],
      customBills: [{ clientId: 'manual-openai', merchantClean: 'OpenAI', monthlyAmount: '$20' }],
      categoryOverrides: [{ category: 'GROCERIES', recommendedAmount: '600' }],
      targetBuffer: '240',
    })).toEqual({
      ok: true,
      value: {
        goalId: 4,
        monthlySavingsCents: 80000,
        planMonth: '2026-07-01',
        monthlyIncomeOverrideCents: 542000,
        billOverrides: [{ recurringStreamId: 9, included: false, monthlyEquivalentCents: 2000 }],
        customBills: [{ clientId: 'manual-openai', merchantClean: 'OpenAI', monthlyEquivalentCents: 2000, category: null, cadence: 'monthly' }],
        categoryOverrides: [{ category: 'GROCERIES', recommendedCents: 60000 }],
        targetBufferCents: 24000,
      },
    });
  });

  it('applies only viable plans and rounds targets up to whole dollars', () => {
    expect(canApplyBudgetPlan(plan('ready'))).toBe(true);
    expect(canApplyBudgetPlan(plan('tight'))).toBe(true);
    expect(canApplyBudgetPlan(plan('shortfall'))).toBe(false);
    expect(canApplyBudgetPlan(plan('needs_income'))).toBe(false);
    expect(appliedBudgetTarget(plan('ready'))).toBe('3301');
    expect(appliedCategoryCaps(plan('ready'))).toEqual({ GROCERIES: 502, COFFEE_SHOPS: 0 });
  });
});
