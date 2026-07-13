import type { EnrichedTransactionView } from '@zenfinance/shared';

export type BudgetPeriod = 'monthly' | 'weekly';

const NON_SPEND = new Set(['INCOME', 'TRANSFER', 'CREDIT_CARD_PAYMENT', 'SAVINGS_AND_INVESTMENT']);

export function budgetCategories(
  transactions: EnrichedTransactionView[],
  period: BudgetPeriod,
  now = new Date(),
): Array<[string, number]> {
  const grouped = new Map<string, number>();
  const start = period === 'weekly'
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
    : new Date(now.getFullYear(), now.getMonth(), 1);
  for (const transaction of transactions) {
    if (new Date(`${transaction.postedDate}T00:00:00`) < start || transaction.pending || transaction.transferPairId) continue;
    const category = transaction.category ?? 'Essentials';
    if (NON_SPEND.has(category)) continue;
    // Positive purchases increase spend and negative refunds offset them.
    // Clamp after the full category is summed so API ordering cannot change
    // the result.
    grouped.set(category, (grouped.get(category) ?? 0) + transaction.amountCents);
  }
  return [...grouped.entries()]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1]);
}

export function moneyMovementDisplay(amountCents: number, currency: (amount: number) => string) {
  const moneyIn = amountCents < 0;
  return {
    moneyIn,
    label: moneyIn ? `+${currency(Math.abs(amountCents))}` : `-${currency(amountCents)}`,
  };
}
