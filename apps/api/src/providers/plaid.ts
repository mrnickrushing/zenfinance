import crypto from 'node:crypto';
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from 'jose';
import {
  Configuration,
  CountryCode,
  type JWKPublicKey,
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
  private webhookKeys = new Map<string, JWKPublicKey>();

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

  async verifyWebhook(rawBody: Buffer, verificationHeader: string | undefined): Promise<boolean> {
    if (!verificationHeader) return false;
    let kid: string;
    try {
      const header = decodeProtectedHeader(verificationHeader);
      if (header.alg !== 'ES256' || typeof header.kid !== 'string') return false;
      kid = header.kid;
    } catch {
      return false;
    }

    const key = await this.webhookVerificationKey(kid);
    if (!key || (key.expired_at !== null && key.expired_at <= Math.floor(Date.now() / 1000))) {
      return false;
    }

    try {
      const publicKey = await importJWK(key as JWK, 'ES256');
      const { payload } = await jwtVerify(verificationHeader, publicKey, { algorithms: ['ES256'] });
      if (typeof payload.iat !== 'number' || Math.abs(Date.now() / 1000 - payload.iat) > 300) {
        return false;
      }
      const expectedHash = crypto.createHash('sha256').update(rawBody).digest('hex');
      return payload.request_body_sha256 === expectedHash;
    } catch {
      return false;
    }
  }

  private async webhookVerificationKey(kid: string): Promise<JWKPublicKey | null> {
    const cached = this.webhookKeys.get(kid);
    if (cached) return cached;
    const res = await this.client.webhookVerificationKeyGet({ key_id: kid });
    const key = res.data.key;
    if (key.kid !== kid) return null;
    this.webhookKeys.set(kid, key);
    return key;
  }
}
