import crypto from 'node:crypto';
import type {
  ExchangeResult,
  ProviderAccount,
  ProviderTransaction,
  SyncPage,
  TransactionProvider,
} from './types.js';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/**
 * Deterministic in-memory provider for dev and tests. One linked "bank" with
 * a checking and a savings account, 90 days of history that exercises the
 * pipeline's edge cases: a pending charge that posts on the second sync
 * (superseding the pending row), a removed transaction, and an own-account
 * transfer pair (checking → savings).
 */
export class MockProvider implements TransactionProvider {
  readonly name = 'mock';
  private syncCounts = new Map<string, number>(); // accessToken → sync generation

  async createLinkToken(userId: number): Promise<{ linkToken: string }> {
    return { linkToken: `mock-link-token-${userId}` };
  }

  async exchangePublicToken(publicToken: string): Promise<ExchangeResult> {
    const suffix = crypto.createHash('sha256').update(publicToken).digest('hex').slice(0, 12);
    return { providerItemId: `mock-item-${suffix}`, accessToken: `mock-access-${suffix}` };
  }

  async fetchAccounts(accessToken: string): Promise<ProviderAccount[]> {
    const id = accessToken.replace('mock-access-', '');
    return [
      {
        providerAccountId: `${id}-checking`,
        name: 'Everyday Checking',
        officialName: 'Mock Bank Everyday Checking',
        type: 'depository',
        subtype: 'checking',
        mask: '4321',
        currentBalanceCents: 284712,
        isoCurrency: 'USD',
      },
      {
        providerAccountId: `${id}-savings`,
        name: 'Rainy Day Savings',
        officialName: 'Mock Bank Savings',
        type: 'depository',
        subtype: 'savings',
        mask: '9876',
        currentBalanceCents: 1250000,
        isoCurrency: 'USD',
      },
    ];
  }

  private backfill(id: string): ProviderTransaction[] {
    const checking = `${id}-checking`;
    const savings = `${id}-savings`;
    const txns: ProviderTransaction[] = [];

    // 90 days of routine spending on checking.
    const merchants: Array<[string, string | null, string, number]> = [
      ['UBER EATS', 'Uber Eats', 'FOOD_AND_DRINK', 2450],
      ['WHOLEFDS #1123', 'Whole Foods Market', 'FOOD_AND_DRINK', 8734],
      ['SHELL OIL', 'Shell', 'TRANSPORTATION', 5210],
      ['NETFLIX.COM', 'Netflix', 'ENTERTAINMENT', 1599],
      ['TARGET 00234', 'Target', 'GENERAL_MERCHANDISE', 4362],
    ];
    for (let day = 3; day <= 90; day += 3) {
      const [name, merchant, category, cents] = merchants[(day / 3) % merchants.length]!;
      txns.push({
        providerTxnId: `${checking}-txn-${day}`,
        providerAccountId: checking,
        amountCents: cents,
        isoCurrency: 'USD',
        postedDate: daysAgo(day),
        name,
        merchantName: merchant,
        providerCategory: category,
        pending: false,
        pendingTxnId: null,
      });
    }

    // Payroll in twice a month (money in = negative per Plaid convention).
    for (const day of [5, 20, 35, 50, 65, 80]) {
      txns.push({
        providerTxnId: `${checking}-payroll-${day}`,
        providerAccountId: checking,
        amountCents: -325000,
        isoCurrency: 'USD',
        postedDate: daysAgo(day),
        name: 'ACME CORP PAYROLL',
        merchantName: null,
        providerCategory: 'INCOME',
        pending: false,
        pendingTxnId: null,
      });
    }

    // Own-account transfer pair: $500 out of checking, $500 into savings, one day apart.
    txns.push(
      {
        providerTxnId: `${checking}-transfer-out`,
        providerAccountId: checking,
        amountCents: 50000,
        isoCurrency: 'USD',
        postedDate: daysAgo(10),
        name: 'ONLINE TRANSFER TO SAVINGS ...9876',
        merchantName: null,
        providerCategory: 'TRANSFER_OUT',
        pending: false,
        pendingTxnId: null,
      },
      {
        providerTxnId: `${savings}-transfer-in`,
        providerAccountId: savings,
        amountCents: -50000,
        isoCurrency: 'USD',
        postedDate: daysAgo(9),
        name: 'ONLINE TRANSFER FROM CHECKING ...4321',
        merchantName: null,
        providerCategory: 'TRANSFER_IN',
        pending: false,
        pendingTxnId: null,
      },
    );

    // A pending charge that will post (and supersede itself) on the next sync.
    txns.push({
      providerTxnId: `${checking}-pending-coffee`,
      providerAccountId: checking,
      amountCents: 675,
      isoCurrency: 'USD',
      postedDate: daysAgo(1),
      name: 'BLUE BOTTLE COFFEE (PENDING)',
      merchantName: 'Blue Bottle Coffee',
      providerCategory: 'FOOD_AND_DRINK',
      pending: true,
      pendingTxnId: null,
    });

    // A duplicate-feed artifact that the provider later removes.
    txns.push({
      providerTxnId: `${checking}-dupe-artifact`,
      providerAccountId: checking,
      amountCents: 1599,
      isoCurrency: 'USD',
      postedDate: daysAgo(2),
      name: 'NETFLIX.COM',
      merchantName: 'Netflix',
      providerCategory: 'ENTERTAINMENT',
      pending: false,
      pendingTxnId: null,
    });

    return txns;
  }

  async syncTransactions(accessToken: string, cursor: string | null): Promise<SyncPage> {
    const id = accessToken.replace('mock-access-', '');
    const generation = cursor ? Number(cursor.replace('mock-cursor-', '')) : 0;
    this.syncCounts.set(accessToken, generation + 1);

    if (generation === 0) {
      return {
        added: this.backfill(id),
        modified: [],
        removedProviderTxnIds: [],
        nextCursor: 'mock-cursor-1',
        hasMore: false,
      };
    }

    if (generation === 1) {
      const checking = `${id}-checking`;
      return {
        // The pending coffee posts with a new id, referencing the pending row.
        added: [
          {
            providerTxnId: `${checking}-posted-coffee`,
            providerAccountId: checking,
            amountCents: 675,
            isoCurrency: 'USD',
            postedDate: daysAgo(0),
            name: 'BLUE BOTTLE COFFEE',
            merchantName: 'Blue Bottle Coffee',
            providerCategory: 'FOOD_AND_DRINK',
            pending: false,
            pendingTxnId: `${checking}-pending-coffee`,
          },
        ],
        modified: [],
        removedProviderTxnIds: [`${checking}-dupe-artifact`],
        nextCursor: 'mock-cursor-2',
        hasMore: false,
      };
    }

    return {
      added: [],
      modified: [],
      removedProviderTxnIds: [],
      nextCursor: `mock-cursor-${generation + 1}`,
      hasMore: false,
    };
  }

  async removeItem(): Promise<void> {
    // Nothing to revoke in the mock.
  }
}
