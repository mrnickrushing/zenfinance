import { NON_SPEND_CATEGORIES } from '../enrichment/categories.js';

interface FinancialTransaction {
  amountCents: number;
  category?: string | null;
  providerCategory?: string | null;
  transferPairId?: string | null;
  name?: string | null;
  merchantName?: string | null;
  accountType?: string | null;
  accountSubtype?: string | null;
}

const PAYCHECK_HINT = /\b(?:payroll|pay\s*check|salary|direct\s*(?:dep|deposit)|dir\s*dep)\b/i;
const DEPOSIT_HINT = /\b(?:mobile|remote|check|cash|branch)?\s*deposit\b/i;
const DEPOSIT_ACCOUNT_TYPES = new Set(['CASH', 'DEPOSITORY']);

function normalized(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

export function isIncomeTransaction(transaction: FinancialTransaction): boolean {
  if (transaction.amountCents >= 0 || transaction.transferPairId) return false;
  const category = normalized(transaction.category);
  const providerCategory = normalized(transaction.providerCategory);
  const providerPrimary = providerCategory.split(/[.:]/)[0] ?? '';
  if (category === 'INCOME' || providerPrimary === 'INCOME' || providerCategory.startsWith('INCOME_')) return true;

  const accountType = normalized(transaction.accountType);
  if (accountType && !DEPOSIT_ACCOUNT_TYPES.has(accountType)) return false;
  const description = `${transaction.name ?? ''} ${transaction.merchantName ?? ''}`;
  if (PAYCHECK_HINT.test(description)) return true;

  // Some institutions label checks/payroll deposited into savings as the
  // generic TRANSFER_IN category. Paired own-account transfers were rejected
  // above; an unpaired deposit description is real external cash inflow.
  return providerPrimary === 'TRANSFER_IN' && DEPOSIT_HINT.test(description);
}

export function spendingContribution(transaction: FinancialTransaction): number {
  if (transaction.transferPairId || isIncomeTransaction(transaction)) return 0;
  const category = normalized(transaction.category);
  if (NON_SPEND_CATEGORIES.has(category)) return 0;
  // Positive purchases add spend; negative refunds/credits offset spend.
  return transaction.amountCents;
}
