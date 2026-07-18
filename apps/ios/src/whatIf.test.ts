import { describe, expect, it } from 'vitest';
import { buildWhatIfRequest } from './whatIf.js';

describe('custom savings what-if inputs', () => {
  it('accepts independent currency inputs and a negative income change', () => {
    expect(buildWhatIfRequest(42, {
      oneTimeSavings: '$1,250.50',
      monthlySpendReduction: '75.25',
      monthlyIncomeChange: '-200',
    })).toEqual({
      ok: true,
      value: {
        goalId: 42,
        oneTimeSavingsCents: 125050,
        monthlySpendReductionCents: 7525,
        monthlyIncomeChangeCents: -20000,
      },
    });
  });

  it('treats blank fields as zero while preserving the entered scenario', () => {
    expect(buildWhatIfRequest(7, {
      oneTimeSavings: '',
      monthlySpendReduction: '150',
      monthlyIncomeChange: '',
    })).toEqual({
      ok: true,
      value: {
        goalId: 7,
        oneTimeSavingsCents: 0,
        monthlySpendReductionCents: 15000,
        monthlyIncomeChangeCents: 0,
      },
    });
  });

  it('rejects empty, malformed, negative savings, and out-of-range scenarios', () => {
    expect(buildWhatIfRequest(1, { oneTimeSavings: '', monthlySpendReduction: '', monthlyIncomeChange: '' })).toEqual({
      ok: false,
      error: 'Enter at least one amount to run a scenario.',
    });
    expect(buildWhatIfRequest(1, { oneTimeSavings: 'later', monthlySpendReduction: '', monthlyIncomeChange: '' }).ok).toBe(false);
    expect(buildWhatIfRequest(1, { oneTimeSavings: '-25', monthlySpendReduction: '', monthlyIncomeChange: '' })).toEqual({
      ok: false,
      error: 'one-time savings cannot be negative.',
    });
    expect(buildWhatIfRequest(1, { oneTimeSavings: '100000.01', monthlySpendReduction: '', monthlyIncomeChange: '' })).toEqual({
      ok: false,
      error: 'one-time savings must be $100,000 or less.',
    });
  });
});
