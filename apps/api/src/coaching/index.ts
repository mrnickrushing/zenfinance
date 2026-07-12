import { env } from '../env.js';
import { AnthropicInsightProvider } from './anthropic.js';
import { MockInsightProvider } from './mock.js';
import type { InsightProvider } from './types.js';

let instance: InsightProvider | null = null;

export function getInsightProvider(): InsightProvider {
  instance ??= env.INSIGHT_PROVIDER === 'mock' ? new MockInsightProvider() : new AnthropicInsightProvider();
  return instance;
}

export type { InsightProvider } from './types.js';
