import { describe, expect, it } from 'vitest';
import type { EnrichedTransactionView } from '@zenfinance/shared';
import { budgetCategories, moneyMovementDisplay } from './budget.js';

function transaction(overrides: Partial<EnrichedTransactionView>): EnrichedTransactionView {
  return {
    id: 1,
    accountId: 1,
    amountCents: 0,
    isoCurrency: 'USD',
    postedDate: '2026-07-13',
    name: 'Test',
    merchantName: null,
    pending: false,
    transferPairId: null,
    category: 'GROCERIES',
    merchantClean: null,
    isDiscretionary: false,
    isRecurring: false,
    confidence: 1,
    enrichmentSource: 'fallback',
    ...overrides,
  };
}

describe('budget calculations', () => {
  it('uses the selected period, offsets refunds, and excludes income/transfers', () => {
    const rows = [
      transaction({ id: 2, amountCents: -2_500 }),
      transaction({ amountCents: 10_000 }),
      transaction({ id: 3, amountCents: -250_000, category: 'INCOME' }),
      transaction({ id: 4, amountCents: 50_000, category: 'TRANSFER' }),
      transaction({ id: 5, amountCents: 5_000, postedDate: '2026-06-30' }),
    ];
    expect(budgetCategories(rows, 'monthly', new Date('2026-07-13T12:00:00'))).toEqual([['GROCERIES', 7_500]]);
  });

  it('shows backend-positive spending as negative and backend-negative income as positive', () => {
    const currency = (amount: number) => `$${(amount / 100).toFixed(2)}`;
    expect(moneyMovementDisplay(1250, currency)).toEqual({ moneyIn: false, label: '-$12.50' });
    expect(moneyMovementDisplay(-1250, currency)).toEqual({ moneyIn: true, label: '+$12.50' });
  });
});
