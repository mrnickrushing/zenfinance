import type { Transaction as PlaidTransaction } from 'plaid';
import { describe, expect, it } from 'vitest';
import { mapPlaidTransaction } from './plaid.js';

describe('Plaid transaction mapping', () => {
  it('uses the raw description and income-source counterparty for a savings paycheck', () => {
    const mapped = mapPlaidTransaction({
      transaction_id: 'paycheck-1',
      account_id: 'savings-1',
      amount: -3100,
      iso_currency_code: 'USD',
      date: '2026-07-05',
      name: 'Mobile Deposit',
      original_description: 'ACME MEDIA DIRECT DEPOSIT',
      merchant_name: null,
      counterparties: [{ name: 'Acme Media LLC', type: 'income_source' }],
      personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_DEPOSIT' },
      pending: false,
      pending_transaction_id: null,
    } as unknown as PlaidTransaction);

    expect(mapped.amountCents).toBe(-310000);
    expect(mapped.name).toBe('ACME MEDIA DIRECT DEPOSIT');
    expect(mapped.merchantName).toBe('Acme Media LLC');
    expect(mapped.providerCategory).toBe('INCOME.TRANSFER_IN_DEPOSIT');
  });
});
