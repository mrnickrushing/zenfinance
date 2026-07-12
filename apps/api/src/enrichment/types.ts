// The AI layer's seam, mirroring providers/types.ts: everything above this
// interface (the pipeline, routes, feature store) is model-agnostic.

export interface FewShotExample {
  merchantKey: string;
  category: string;
  isDiscretionary: boolean;
}

export interface EnrichmentInput {
  transactionId: number;
  name: string;
  merchantName: string | null;
  providerCategory: string | null;
  amountCents: number;
  postedDate: string;
}

export interface EnrichmentResult {
  transactionId: number;
  category: string;
  merchantClean: string;
  isRecurring: boolean;
  isDiscretionary: boolean;
  confidence: number; // 0..1
  // Provenance: 'llm' for a real model/rule-engine judgment, 'fallback' when
  // the provider couldn't classify (API error, refusal, no keyword match)
  // and used the deterministic provider-category mapping instead.
  source: 'llm' | 'fallback';
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface EnrichmentBatchResult {
  results: EnrichmentResult[];
  usage: TokenUsage | null; // null when the batch never reached the model (e.g. mock provider)
}

export interface EnrichmentProvider {
  readonly name: string;
  readonly model: string;
  /**
   * Enrich a batch of transactions. `fewShotExamples` are this user's prior
   * corrections (most-recent-first, already deduped by merchant) — providers
   * that don't use in-context examples (the mock) may ignore them.
   */
  enrichBatch(
    inputs: EnrichmentInput[],
    fewShotExamples: FewShotExample[],
  ): Promise<EnrichmentBatchResult>;
}
