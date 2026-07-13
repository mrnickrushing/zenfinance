import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { CATEGORY_IDS, isValidCategory } from './categories.js';
import { env } from '../env.js';
import { safeErrorSummary } from '../lib/safeError.js';
import { mapProviderCategoryToTaxonomy } from './fallback.js';
import type {
  EnrichmentBatchResult,
  EnrichmentInput,
  EnrichmentProvider,
  EnrichmentResult,
  FewShotExample,
} from './types.js';

const resultSchema = z.object({
  transactionId: z.number().int(),
  category: z.enum(CATEGORY_IDS),
  merchantClean: z.string().min(1).max(120),
  isRecurring: z.boolean(),
  isDiscretionary: z.boolean(),
  confidence: z.number().min(0).max(1),
});
const responseSchema = z.object({ results: z.array(resultSchema) });

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          transactionId: { type: 'integer' },
          category: { type: 'string', enum: CATEGORY_IDS },
          merchantClean: { type: 'string' },
          isRecurring: { type: 'boolean' },
          isDiscretionary: { type: 'boolean' },
          confidence: { type: 'number' },
        },
        required: ['transactionId', 'category', 'merchantClean', 'isRecurring', 'isDiscretionary', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You categorize personal bank/card transactions for a coaching app (not accounting software).
For each transaction, return: a category from the fixed taxonomy, a clean display merchant name (title case, no store numbers or trailing codes), whether it looks like a recurring bill/subscription, whether it's discretionary (a "cut back" candidate) vs essential, and your confidence (0-1).
Prefer the user's past corrections for a merchant over your own judgment when one is given. If a transaction name is ambiguous, use amount and any provider category hint. Return every input transactionId exactly once, in the "results" array, in the same order.`;

/** Real Haiku-backed enrichment provider — batched structured-output calls. */
export class AnthropicEnrichmentProvider implements EnrichmentProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private client: Anthropic;

  constructor() {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured for ENRICHMENT_PROVIDER=anthropic');
    }
    this.model = env.ENRICHMENT_MODEL;
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  async enrichBatch(
    inputs: EnrichmentInput[],
    fewShotExamples: FewShotExample[],
  ): Promise<EnrichmentBatchResult> {
    if (inputs.length === 0) return { results: [], usage: null };

    const fewShotBlock =
      fewShotExamples.length > 0
        ? `\n\nThis user has previously corrected these merchants — trust these over your own judgment:\n${fewShotExamples
            .slice(0, 15)
            .map((e) => `- "${e.merchantKey}" -> ${e.category}, discretionary=${e.isDiscretionary}`)
            .join('\n')}`
        : '';

    const userContent = `Categorize these ${inputs.length} transactions.${fewShotBlock}\n\nTransactions:\n${JSON.stringify(
      inputs.map((t) => ({
        transactionId: t.transactionId,
        name: t.name,
        merchantName: t.merchantName,
        providerCategory: t.providerCategory,
        amountCents: t.amountCents,
        postedDate: t.postedDate,
      })),
    )}`;

    let response;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: Math.min(2000 + inputs.length * 120, 16000),
        system: SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: JSON_SCHEMA } },
        messages: [{ role: 'user', content: userContent }],
      });
    } catch (err) {
      console.error('[enrichment] Anthropic API call failed, falling back to deterministic mapping:', safeErrorSummary(err));
      return {
        results: inputs.map(mapProviderCategoryToTaxonomy),
        usage: null,
      };
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };

    if (response.stop_reason === 'refusal') {
      console.error('[enrichment] Anthropic refused the batch; falling back to deterministic mapping');
      return { results: inputs.map(mapProviderCategoryToTaxonomy), usage };
    }

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    let parsed: EnrichmentResult[];
    try {
      const json = responseSchema.parse(JSON.parse(textBlock?.text ?? ''));
      const byId = new Map(json.results.map((r) => [r.transactionId, r]));
      parsed = inputs.map((input) => {
        const r = byId.get(input.transactionId);
        if (!r || !isValidCategory(r.category)) {
          return mapProviderCategoryToTaxonomy(input);
        }
        return {
          transactionId: input.transactionId,
          category: r.category,
          merchantClean: r.merchantClean,
          isRecurring: r.isRecurring,
          isDiscretionary: r.isDiscretionary,
          confidence: r.confidence,
          source: 'llm' as const,
        };
      });
    } catch (err) {
      console.error('[enrichment] Failed to parse/validate model output, falling back:', safeErrorSummary(err));
      parsed = inputs.map(mapProviderCategoryToTaxonomy);
    }

    return { results: parsed, usage };
  }
}
