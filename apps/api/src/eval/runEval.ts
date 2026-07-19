import type { EnrichmentInput, EnrichmentProvider } from '../enrichment/types.js';
import { HELD_OUT_FIXTURES, type LabeledTransaction } from './fixtures.js';

const BATCH_SIZE = 75;

export interface Misclassification {
  transactionId: number;
  name: string;
  expectedCategory: string;
  actualCategory: string;
  expectedIsDiscretionary: boolean;
  actualIsDiscretionary: boolean;
}

export interface EvalResult {
  total: number;
  correctDiscretionary: number;
  correctCategory: number;
  discretionaryAccuracy: number;
  categoryAccuracy: number;
  misclassified: Misclassification[];
}

/**
 * Runs a provider over the held-out fixture set with no few-shot context
 * (the eval measures baseline judgment, not the correction-loop crutch) and
 * scores it against PLAN §8's Phase 2 exit gate: discretionary/essential
 * split accuracy on held-out data, not exact-category match.
 */
export async function runDiscretionaryEval(
  provider: EnrichmentProvider,
  fixtures: LabeledTransaction[] = HELD_OUT_FIXTURES,
): Promise<EvalResult> {
  const resultsById = new Map<number, { category: string; isDiscretionary: boolean }>();

  for (let i = 0; i < fixtures.length; i += BATCH_SIZE) {
    const batch = fixtures.slice(i, i + BATCH_SIZE);
    const inputs: EnrichmentInput[] = batch.map((f) => ({
      transactionId: f.transactionId,
      name: f.name,
      merchantName: f.merchantName,
      providerCategory: f.providerCategory,
      amountCents: f.amountCents,
      postedDate: f.postedDate,
      accountType: 'depository',
      accountSubtype: 'checking',
      transferPairId: null,
    }));
    const { results } = await provider.enrichBatch(inputs, []);
    for (const r of results) {
      resultsById.set(r.transactionId, { category: r.category, isDiscretionary: r.isDiscretionary });
    }
  }

  let correctDiscretionary = 0;
  let correctCategory = 0;
  const misclassified: Misclassification[] = [];

  for (const f of fixtures) {
    const r = resultsById.get(f.transactionId);
    if (!r) continue;
    const discretionaryMatch = r.isDiscretionary === f.expectedIsDiscretionary;
    const categoryMatch = r.category === f.expectedCategory;
    if (discretionaryMatch) correctDiscretionary++;
    if (categoryMatch) correctCategory++;
    if (!discretionaryMatch || !categoryMatch) {
      misclassified.push({
        transactionId: f.transactionId,
        name: f.name,
        expectedCategory: f.expectedCategory,
        actualCategory: r.category,
        expectedIsDiscretionary: f.expectedIsDiscretionary,
        actualIsDiscretionary: r.isDiscretionary,
      });
    }
  }

  return {
    total: fixtures.length,
    correctDiscretionary,
    correctCategory,
    discretionaryAccuracy: correctDiscretionary / fixtures.length,
    categoryAccuracy: correctCategory / fixtures.length,
    misclassified,
  };
}
