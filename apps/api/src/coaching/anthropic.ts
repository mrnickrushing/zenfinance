import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../env.js';
import { BRIEF_JSON_SCHEMA, COACHING_SYSTEM_PROMPT, renderContextMessage } from './policy.js';
import type { BriefDraft, CoachingContext, InsightProvider, TokenUsage } from './types.js';

const wireSchema = z.object({
  headline: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  action: z.object({
    description: z.string().min(1).max(600),
    estimated_impact_usd: z.number().nullable(),
    timeframe: z.string().min(1).max(80),
  }),
  claims: z.array(
    z.object({
      amount_usd: z.number(),
      source_aggregate_id: z.string().min(1),
      label: z.string().min(1).max(200),
    }),
  ),
  tone_check: z.number().min(0).max(1),
});

function toCents(usd: number): number {
  return Math.round(usd * 100);
}

/** Real Sonnet-backed coaching brief generator (PLAN §3). */
export class AnthropicInsightProvider implements InsightProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private client: Anthropic;

  constructor() {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured for INSIGHT_PROVIDER=anthropic');
    }
    this.model = env.INSIGHT_MODEL;
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  async generateBrief(context: CoachingContext): Promise<{ draft: BriefDraft; usage: TokenUsage | null }> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1500,
      system: COACHING_SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: BRIEF_JSON_SCHEMA } },
      messages: [{ role: 'user', content: renderContextMessage(context) }],
    });

    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };

    if (response.stop_reason === 'refusal') {
      throw new Error('coaching model refused the request');
    }

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    const parsed = wireSchema.parse(JSON.parse(textBlock?.text ?? ''));

    const draft: BriefDraft = {
      headline: parsed.headline,
      body: parsed.body,
      action: {
        description: parsed.action.description,
        estimatedImpactCents: parsed.action.estimated_impact_usd === null ? null : toCents(parsed.action.estimated_impact_usd),
        timeframe: parsed.action.timeframe,
      },
      claims: parsed.claims.map((c) => ({
        amountCents: toCents(c.amount_usd),
        sourceAggregateId: c.source_aggregate_id,
        label: c.label,
      })),
      toneCheck: parsed.tone_check,
    };

    return { draft, usage };
  }
}
