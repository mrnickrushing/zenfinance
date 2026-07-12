import { env } from '../env.js';
import { MockProvider } from './mock.js';
import { PlaidProvider } from './plaid.js';
import type { TransactionProvider } from './types.js';

let instance: TransactionProvider | null = null;

export function getProvider(): TransactionProvider {
  instance ??= env.TRANSACTION_PROVIDER === 'mock' ? new MockProvider() : new PlaidProvider();
  return instance;
}

export type { TransactionProvider } from './types.js';
