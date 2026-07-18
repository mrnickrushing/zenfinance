import type { BudgetPlanInput, BudgetPlanView } from '@zenfinance/shared';

export const BUDGET_PLAN_MAX_DOLLARS = 100_000;

export type BudgetPlanRequestResult =
  | { ok: true; value: BudgetPlanInput }
  | { ok: false; error: string };

function parseMonthlySavings(raw: string): number | string {
  const formatted = raw.trim();
  if (!formatted) return 'Enter what you want to save this month.';
  const currencyPattern = /^\$?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{0,2})?|\.\d{1,2})$/;
  if (!currencyPattern.test(formatted)) return 'Enter a valid monthly savings amount.';
  const dollars = Number(formatted.replace(/[$,]/g, ''));
  if (!Number.isFinite(dollars) || dollars <= 0) return 'Monthly savings must be greater than zero.';
  if (dollars > BUDGET_PLAN_MAX_DOLLARS) return 'Monthly savings must be $100,000 or less.';
  return Math.round(dollars * 100);
}

export function localPlanMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export function buildBudgetPlanRequest(goalId: number | null, monthlySavings: string, now = new Date()): BudgetPlanRequestResult {
  if (!goalId) return { ok: false, error: 'Choose a savings goal first.' };
  const monthlySavingsCents = parseMonthlySavings(monthlySavings);
  if (typeof monthlySavingsCents === 'string') return { ok: false, error: monthlySavingsCents };
  return { ok: true, value: { goalId, monthlySavingsCents, planMonth: localPlanMonth(now) } };
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
