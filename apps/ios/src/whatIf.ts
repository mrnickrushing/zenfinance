export const WHAT_IF_MAX_DOLLARS = 100_000;

export interface WhatIfDraft {
  oneTimeSavings: string;
  monthlySpendReduction: string;
  monthlyIncomeChange: string;
}

export interface WhatIfRequest {
  goalId: number;
  oneTimeSavingsCents: number;
  monthlySpendReductionCents: number;
  monthlyIncomeChangeCents: number;
}

export type WhatIfRequestResult =
  | { ok: true; value: WhatIfRequest }
  | { ok: false; error: string };

function parseDollarInput(raw: string, label: string, allowNegative = false): number | string {
  const formatted = raw.trim();
  if (!formatted) return 0;
  const currencyPattern = /^(?:[+-]?\$?|\$[+-]?)(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{0,2})?|\.\d{1,2})$/;
  if (!currencyPattern.test(formatted)) return `Enter a valid amount for ${label}.`;
  const normalized = formatted.replace(/[$,]/g, '');

  const dollars = Number(normalized);
  if (!Number.isFinite(dollars)) return `Enter a valid amount for ${label}.`;
  if (!allowNegative && dollars < 0) return `${label} cannot be negative.`;
  if (Math.abs(dollars) > WHAT_IF_MAX_DOLLARS) return `${label} must be $100,000 or less.`;
  return Math.round(dollars * 100);
}

export function buildWhatIfRequest(goalId: number, draft: WhatIfDraft): WhatIfRequestResult {
  const oneTimeSavingsCents = parseDollarInput(draft.oneTimeSavings, 'one-time savings');
  if (typeof oneTimeSavingsCents === 'string') return { ok: false, error: oneTimeSavingsCents };

  const monthlySpendReductionCents = parseDollarInput(draft.monthlySpendReduction, 'monthly spending reduction');
  if (typeof monthlySpendReductionCents === 'string') return { ok: false, error: monthlySpendReductionCents };

  const monthlyIncomeChangeCents = parseDollarInput(draft.monthlyIncomeChange, 'monthly income change', true);
  if (typeof monthlyIncomeChangeCents === 'string') return { ok: false, error: monthlyIncomeChangeCents };

  if (oneTimeSavingsCents === 0 && monthlySpendReductionCents === 0 && monthlyIncomeChangeCents === 0) {
    return { ok: false, error: 'Enter at least one amount to run a scenario.' };
  }

  return {
    ok: true,
    value: { goalId, oneTimeSavingsCents, monthlySpendReductionCents, monthlyIncomeChangeCents },
  };
}
