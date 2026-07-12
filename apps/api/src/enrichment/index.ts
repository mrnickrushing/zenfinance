import { env } from '../env.js';
import { AnthropicEnrichmentProvider } from './anthropic.js';
import { MockEnrichmentProvider } from './mock.js';
import type { EnrichmentProvider } from './types.js';

let instance: EnrichmentProvider | null = null;

export function getEnrichmentProvider(): EnrichmentProvider {
  instance ??= env.ENRICHMENT_PROVIDER === 'mock' ? new MockEnrichmentProvider() : new AnthropicEnrichmentProvider();
  return instance;
}

export type { EnrichmentProvider } from './types.js';
