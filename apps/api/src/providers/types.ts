// The aggregator seam. Everything above this interface is provider-agnostic,
// so swapping Plaid for Teller (or a §1033-era API) touches only this layer.

export interface ProviderAccount {
  providerAccountId: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalanceCents: number | null;
  isoCurrency: string;
}

export interface ProviderTransaction {
  providerTxnId: string;
  providerAccountId: string;
  amountCents: number; // positive = money out, negative = money in
  isoCurrency: string;
  postedDate: string; // YYYY-MM-DD
  name: string;
  merchantName: string | null;
  providerCategory: string | null;
  pending: boolean;
  pendingTxnId: string | null; // set on posted txns that supersede a pending one
}

export interface SyncPage {
  added: ProviderTransaction[];
  modified: ProviderTransaction[];
  removedProviderTxnIds: string[];
  nextCursor: string;
  hasMore: boolean;
}

export interface ExchangeResult {
  providerItemId: string;
  accessToken: string;
}

export interface TransactionProvider {
  readonly name: string;
  createLinkToken(userId: number): Promise<{ linkToken: string }>;
  exchangePublicToken(publicToken: string): Promise<ExchangeResult>;
  fetchAccounts(accessToken: string): Promise<ProviderAccount[]>;
  // Forces a live balance check with the institution rather than returning
  // whatever the provider has cached (what fetchAccounts returns). Requires
  // the Balance product to be enabled in production, separate from
  // Transactions -- see DEPLOY.md.
  refreshBalances(accessToken: string): Promise<ProviderAccount[]>;
  syncTransactions(accessToken: string, cursor: string | null): Promise<SyncPage>;
  removeItem(accessToken: string): Promise<void>;
  verifyWebhook?(rawBody: Buffer, verificationHeader: string | undefined): Promise<boolean>;
}
