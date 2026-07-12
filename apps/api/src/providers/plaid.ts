import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type Transaction as PlaidTransaction,
} from 'plaid';
import { env } from '../env.js';
import type {
  ExchangeResult,
  ProviderAccount,
  ProviderTransaction,
  SyncPage,
  TransactionProvider,
} from './types.js';

function toCents(amount: number | null | undefined): number {
  return Math.round((amount ?? 0) * 100);
}

function mapTxn(t: PlaidTransaction): ProviderTransaction {
  return {
    providerTxnId: t.transaction_id,
    providerAccountId: t.account_id,
    amountCents: toCents(t.amount),
    isoCurrency: t.iso_currency_code ?? 'USD',
    postedDate: t.date,
    name: t.name,
    merchantName: t.merchant_name ?? null,
    providerCategory: t.personal_finance_category?.primary ?? null,
    pending: t.pending,
    pendingTxnId: t.pending_transaction_id ?? null,
  };
}

export class PlaidProvider implements TransactionProvider {
  readonly name = 'plaid';
  private client: PlaidApi;

  constructor() {
    if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
      throw new Error('PLAID_CLIENT_ID and PLAID_SECRET are required when TRANSACTION_PROVIDER=plaid');
    }
    this.client = new PlaidApi(
      new Configuration({
        basePath: PlaidEnvironments[env.PLAID_ENV]!,
        baseOptions: {
          headers: {
            'PLAID-CLIENT-ID': env.PLAID_CLIENT_ID,
            'PLAID-SECRET': env.PLAID_SECRET,
          },
        },
      }),
    );
  }

  async createLinkToken(userId: number): Promise<{ linkToken: string }> {
    const res = await this.client.linkTokenCreate({
      user: { client_user_id: String(userId) },
      client_name: 'ZenFinance',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
      transactions: { days_requested: 90 }, // first-look brief needs 90 days on day one
    });
    return { linkToken: res.data.link_token };
  }

  async exchangePublicToken(publicToken: string): Promise<ExchangeResult> {
    const res = await this.client.itemPublicTokenExchange({ public_token: publicToken });
    return { providerItemId: res.data.item_id, accessToken: res.data.access_token };
  }

  async fetchAccounts(accessToken: string): Promise<ProviderAccount[]> {
    const res = await this.client.accountsGet({ access_token: accessToken });
    return res.data.accounts.map((a) => ({
      providerAccountId: a.account_id,
      name: a.name,
      officialName: a.official_name ?? null,
      type: a.type,
      subtype: a.subtype ?? null,
      mask: a.mask ?? null,
      currentBalanceCents: a.balances.current == null ? null : toCents(a.balances.current),
      isoCurrency: a.balances.iso_currency_code ?? 'USD',
    }));
  }

  async syncTransactions(accessToken: string, cursor: string | null): Promise<SyncPage> {
    const res = await this.client.transactionsSync({
      access_token: accessToken,
      cursor: cursor ?? undefined,
      count: 500,
    });
    return {
      added: res.data.added.map(mapTxn),
      modified: res.data.modified.map(mapTxn),
      removedProviderTxnIds: res.data.removed
        .map((r) => r.transaction_id)
        .filter((id): id is string => Boolean(id)),
      nextCursor: res.data.next_cursor,
      hasMore: res.data.has_more,
    };
  }

  async removeItem(accessToken: string): Promise<void> {
    await this.client.itemRemove({ access_token: accessToken });
  }
}
