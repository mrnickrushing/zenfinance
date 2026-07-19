import { describe, expect, it } from 'vitest';
import { isIncomeTransaction, spendingContribution } from './classify.js';

describe('financial transaction classification', () => {
  it('only treats authoritative negative inflows as income', () => {
    expect(isIncomeTransaction({ amountCents: -250_000, providerCategory: 'INCOME_WAGES' })).toBe(true);
    expect(isIncomeTransaction({ amountCents: -250_000, providerCategory: 'INCOME.INCOME_WAGES' })).toBe(true);
    expect(isIncomeTransaction({ amountCents: -5_000, category: 'Income' })).toBe(true);
    expect(isIncomeTransaction({ amountCents: -5_000, category: 'Shopping' })).toBe(false);
    expect(isIncomeTransaction({ amountCents: 5_000, category: 'Income' })).toBe(false);
    expect(isIncomeTransaction({
      amountCents: -310_000,
      providerCategory: 'TRANSFER_IN.TRANSFER_IN_DEPOSIT',
      name: 'MOBILE DEPOSIT',
      accountType: 'depository',
      accountSubtype: 'savings',
    })).toBe(true);
    expect(isIncomeTransaction({
      amountCents: -310_000,
      providerCategory: 'TRANSFER_IN.TRANSFER_IN_DEPOSIT',
      name: 'MOBILE DEPOSIT',
      accountType: 'depository',
      accountSubtype: 'savings',
      transferPairId: 'own-account-pair',
    })).toBe(false);
    expect(isIncomeTransaction({
      amountCents: -310_000,
      providerCategory: 'TRANSFER_IN',
      name: 'MOBILE DEPOSIT',
      accountType: 'credit',
    })).toBe(false);
  });

  it('excludes transfers and nets refunds against purchases', () => {
    expect(spendingContribution({ amountCents: 25_00, category: 'Dining' })).toBe(25_00);
    expect(spendingContribution({ amountCents: -10_00, category: 'Dining' })).toBe(-10_00);
    expect(spendingContribution({ amountCents: 50_00, category: 'Transfer' })).toBe(0);
    expect(spendingContribution({ amountCents: 50_00, transferPairId: 'pair-1' })).toBe(0);
    expect(spendingContribution({ amountCents: -50_00, providerCategory: 'INCOME_WAGES' })).toBe(0);
  });
});
