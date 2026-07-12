import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from '../enrichment/cost.js';
import { HELD_OUT_FIXTURES } from '../eval/fixtures.js';
import { MockEnrichmentProvider } from '../enrichment/mock.js';
import { runDiscretionaryEval } from '../eval/runEval.js';

describe('Phase 2 exit gate: enrichment accuracy', () => {
  it('held-out set has the expected split (400 held out of 500)', () => {
    expect(HELD_OUT_FIXTURES.length).toBe(400);
  });

  it('clears >=90% discretionary/essential accuracy on the held-out set (PLAN §8)', async () => {
    const result = await runDiscretionaryEval(new MockEnrichmentProvider());
    expect(result.total).toBe(400);
    expect(result.discretionaryAccuracy).toBeGreaterThanOrEqual(0.9);
  });
});

describe('Phase 2 exit gate: enrichment cost per user per month', () => {
  it('stays under $0.10/user/month at typical transaction volume (PLAN §8)', () => {
    // A moderately active user generates ~300 transactions/month. Batched at
    // 75/call, that's 4 calls. Each call pays a shared system-prompt
    // overhead (~250 tokens, conservatively assumed uncached) plus ~30
    // input tokens and ~35 output tokens per transaction for the JSON
    // result — these are the same per-transaction assumptions the real
    // Haiku prompt in enrichment/anthropic.ts targets.
    const TRANSACTIONS_PER_MONTH = 300;
    const BATCH_SIZE = 75;
    const SYSTEM_PROMPT_TOKENS = 250;
    const INPUT_TOKENS_PER_TXN = 30;
    const OUTPUT_TOKENS_PER_TXN = 35;

    const batches = Math.ceil(TRANSACTIONS_PER_MONTH / BATCH_SIZE);
    const inputTokens = batches * SYSTEM_PROMPT_TOKENS + TRANSACTIONS_PER_MONTH * INPUT_TOKENS_PER_TXN;
    const outputTokens = TRANSACTIONS_PER_MONTH * OUTPUT_TOKENS_PER_TXN;

    const costUsd = estimateCostUsd('claude-haiku-4-5', inputTokens, outputTokens);
    expect(costUsd).toBeLessThan(0.1);
  });
});
