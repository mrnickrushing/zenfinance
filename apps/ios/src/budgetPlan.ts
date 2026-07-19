import type { BudgetPlanInput, BudgetPlanView } from '@zenfinance/shared';

export const BUDGET_PLAN_MAX_DOLLARS = 100_000;

export type BudgetPlanRequestResult =
  | { ok: true; value: BudgetPlanInput }
  | { ok: false; error: string };

export interface BudgetPlanAdjustmentDraft {
  monthlyIncome?: string;
  billOverrides?: Array<{ recurringStreamId: number; included: boolean; monthlyAmount: string }>;
  customBills?: Array<{ clientId: string; merchantClean: string; monthlyAmount: string; category?: string | null }>;
  categoryOverrides?: Array<{ category: string; recommendedAmount: string }>;
  targetBuffer?: string;
}

export function parseBudgetAmount(raw: string, label: string, allowZero = false): number | string {
  const formatted = raw.trim();
  if (!formatted) return `Enter ${label.toLowerCase()}.`;
  const currencyPattern = /^\$?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{0,2})?|\.\d{1,2})$/;
  if (!currencyPattern.test(formatted)) return `Enter a valid ${label.toLowerCase()}.`;
  const dollars = Number(formatted.replace(/[$,]/g, ''));
  if (!Number.isFinite(dollars) || (allowZero ? dollars < 0 : dollars <= 0)) {
    return allowZero ? `${label} cannot be negative.` : `${label} must be greater than zero.`;
  }
  if (dollars > BUDGET_PLAN_MAX_DOLLARS) return `${label} must be $100,000 or less.`;
  return Math.round(dollars * 100);
}

export function localPlanMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export function buildBudgetPlanRequest(
  goalId: number | null,
  monthlySavings: string,
  now = new Date(),
  adjustments: BudgetPlanAdjustmentDraft = {},
): BudgetPlanRequestResult {
  if (!goalId) return { ok: false, error: 'Choose a savings goal first.' };
  const monthlySavingsCents = parseBudgetAmount(monthlySavings, 'Monthly savings');
  if (typeof monthlySavingsCents === 'string') return { ok: false, error: monthlySavingsCents };
  const value: BudgetPlanInput = { goalId, monthlySavingsCents, planMonth: localPlanMonth(now) };

  if (adjustments.monthlyIncome?.trim()) {
    const parsed = parseBudgetAmount(adjustments.monthlyIncome, 'Monthly income', true);
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    value.monthlyIncomeOverrideCents = parsed;
  }
  if (adjustments.billOverrides?.length) {
    value.billOverrides = [];
    for (const bill of adjustments.billOverrides) {
      const parsed = parseBudgetAmount(bill.monthlyAmount, 'Bill amount', true);
      if (typeof parsed === 'string') return { ok: false, error: parsed };
      value.billOverrides.push({ recurringStreamId: bill.recurringStreamId, included: bill.included, monthlyEquivalentCents: parsed });
    }
  }
  if (adjustments.customBills?.length) {
    value.customBills = [];
    for (const bill of adjustments.customBills) {
      if (!bill.merchantClean.trim()) return { ok: false, error: 'Enter a name for every added bill.' };
      const parsed = parseBudgetAmount(bill.monthlyAmount, `${bill.merchantClean.trim()} amount`);
      if (typeof parsed === 'string') return { ok: false, error: parsed };
      value.customBills.push({
        clientId: bill.clientId,
        merchantClean: bill.merchantClean.trim(),
        monthlyEquivalentCents: parsed,
        category: bill.category ?? null,
        cadence: 'monthly',
      });
    }
  }
  if (adjustments.categoryOverrides?.length) {
    value.categoryOverrides = [];
    for (const category of adjustments.categoryOverrides) {
      const parsed = parseBudgetAmount(category.recommendedAmount, `${category.category} spending limit`, true);
      if (typeof parsed === 'string') return { ok: false, error: parsed };
      value.categoryOverrides.push({ category: category.category, recommendedCents: parsed });
    }
  }
  if (adjustments.targetBuffer?.trim()) {
    const parsed = parseBudgetAmount(adjustments.targetBuffer, 'Safety buffer', true);
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    value.targetBufferCents = parsed;
  }
  return { ok: true, value };
}

export function canApplyBudgetPlan(plan: BudgetPlanView): boolean {
  return (plan.status === 'ready' || plan.status === 'tight') && plan.recommendedSpendingCents > 0;
}

export function appliedBudgetTarget(plan: BudgetPlanView): string {
  return String(Math.ceil(plan.recommendedSpendingCents / 100));
}

export function appliedCategoryCaps(plan: BudgetPlanView): Record<string, number> {
  return Object.fromEntries(
    plan.categories.map((category) => [
      category.category,
      category.recommendedCents === 0 ? 0 : Math.max(1, Math.ceil(category.recommendedCents / 100)),
    ]),
  );
}
