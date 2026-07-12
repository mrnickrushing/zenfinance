import { and, eq, gte, lt, sum } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { aiUsageEvents } from '../db/schema.js';

// Published per-million-token pricing (input/output USD). Haiku is the
// enrichment workhorse per PLAN §3; Sonnet entries are here for the Phase 3
// insight-generation job that will reuse this same metering.
const PRICING_PER_MTOK_USD: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-5': { input: 3.0, output: 15.0 },
};
const DEFAULT_PRICING = PRICING_PER_MTOK_USD['claude-haiku-4-5']!;

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING_PER_MTOK_USD[model] ?? DEFAULT_PRICING;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

export async function recordAiUsage(
  db: Db,
  params: { userId: number; purpose: string; model: string; inputTokens: number; outputTokens: number },
): Promise<void> {
  await db.insert(aiUsageEvents).values({
    userId: params.userId,
    purpose: params.purpose,
    model: params.model,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    estimatedCostUsd: estimateCostUsd(params.model, params.inputTokens, params.outputTokens),
  });
}

/** Sum of estimated AI cost for a user within [monthStart, monthEnd). */
export async function getMonthlyAiCostUsd(
  db: Db,
  userId: number,
  monthStart: Date,
  monthEnd: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: sum(aiUsageEvents.estimatedCostUsd) })
    .from(aiUsageEvents)
    .where(
      and(
        eq(aiUsageEvents.userId, userId),
        gte(aiUsageEvents.createdAt, monthStart),
        lt(aiUsageEvents.createdAt, monthEnd),
      ),
    );
  return Number(row?.total ?? 0);
}
