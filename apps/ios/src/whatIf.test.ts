import { describe, expect, it } from 'vitest';
import { buildWhatIfRequest, hasAdvancedWhatIfAdjustments } from './whatIf.js';

describe('custom savings what-if inputs', () => {
  it('accepts independent currency inputs and a negative income change', () => {
    expect(buildWhatIfRequest(42, {
      monthlySavings: '300',
      oneTimeSavings: '$1,250.50',
      monthlySpendReduction: '75.25',
      monthlyIncomeChange: '-200',
    }, new Date(2026, 6, 18, 12))).toEqual({
      ok: true,
      value: {
        goalId: 42,
        forecastStartMonth: '2026-07-01',
        monthlySavingsCents: 30000,
        oneTimeSavingsCents: 125050,
        monthlySpendReductionCents: 7525,
        monthlyIncomeChangeCents: -20000,
      },
    });
  });

  it('treats blank fields as zero while preserving the entered scenario', () => {
    expect(buildWhatIfRequest(7, {
      monthlySavings: '200',
      oneTimeSavings: '',
      monthlySpendReduction: '',
      monthlyIncomeChange: '',
    }, new Date(2026, 6, 18, 12))).toEqual({
      ok: true,
      value: {
        goalId: 7,
        forecastStartMonth: '2026-07-01',
        monthlySavingsCents: 20000,
        oneTimeSavingsCents: 0,
        monthlySpendReductionCents: 0,
        monthlyIncomeChangeCents: 0,
      },
    });
  });

  it('rejects empty, malformed, negative savings, and out-of-range scenarios', () => {
    expect(buildWhatIfRequest(1, { monthlySavings: '', oneTimeSavings: '', monthlySpendReduction: '', monthlyIncomeChange: '' })).toEqual({
      ok: false,
      error: 'Enter at least one amount to run a scenario.',
    });
    expect(buildWhatIfRequest(1, { monthlySavings: '', oneTimeSavings: 'later', monthlySpendReduction: '', monthlyIncomeChange: '' }).ok).toBe(false);
    for (const malformed of ['1 2', '1,2,3', '1.001']) {
      expect(buildWhatIfRequest(1, { monthlySavings: '', oneTimeSavings: malformed, monthlySpendReduction: '', monthlyIncomeChange: '' })).toEqual({
        ok: false,
        error: 'Enter a valid amount for one-time savings.',
      });
    }
    expect(buildWhatIfRequest(1, { monthlySavings: '', oneTimeSavings: '-25', monthlySpendReduction: '', monthlyIncomeChange: '' })).toEqual({
      ok: false,
      error: 'one-time savings cannot be negative.',
    });
    expect(buildWhatIfRequest(1, { monthlySavings: '-50', oneTimeSavings: '', monthlySpendReduction: '', monthlyIncomeChange: '' })).toEqual({
      ok: false,
      error: 'monthly savings cannot be negative.',
    });
    expect(buildWhatIfRequest(1, { monthlySavings: '', oneTimeSavings: '100000.01', monthlySpendReduction: '', monthlyIncomeChange: '' })).toEqual({
      ok: false,
      error: 'one-time savings must be $100,000 or less.',
    });
  });

  it('keeps retained advanced adjustments visible, including invalid drafts', () => {
    const base = { monthlySavings: '200', oneTimeSavings: '', monthlySpendReduction: '', monthlyIncomeChange: '' };
    expect(hasAdvancedWhatIfAdjustments(base)).toBe(false);
    expect(hasAdvancedWhatIfAdjustments({ ...base, monthlySpendReduction: '0.00', monthlyIncomeChange: '$0' })).toBe(false);
    expect(hasAdvancedWhatIfAdjustments({ ...base, monthlySpendReduction: '75' })).toBe(true);
    expect(hasAdvancedWhatIfAdjustments({ ...base, monthlyIncomeChange: '-25' })).toBe(true);
    expect(hasAdvancedWhatIfAdjustments({ ...base, monthlyIncomeChange: 'later' })).toBe(true);
  });
});
