import { NON_SPEND_CATEGORIES } from '../enrichment/categories.js';

interface FinancialTransaction {
  amountCents: number;
  category?: string | null;
  providerCategory?: string | null;
  transferPairId?: string | null;
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

export function isIncomeTransaction(transaction: FinancialTransaction): boolean {
  if (transaction.amountCents >= 0 || transaction.transferPairId) return false;
  const category = normalized(transaction.category);
  const providerCategory = normalized(transaction.providerCategory);
  return category === 'INCOME' || providerCategory === 'INCOME' || providerCategory.startsWith('INCOME_');
}

export function spendingContribution(transaction: FinancialTransaction): number {
  if (transaction.transferPairId || isIncomeTransaction(transaction)) return 0;
  const category = normalized(transaction.category);
  if (NON_SPEND_CATEGORIES.has(category)) return 0;
  // Positive purchases add spend; negative refunds/credits offset spend.
  return transaction.amountCents;
}
