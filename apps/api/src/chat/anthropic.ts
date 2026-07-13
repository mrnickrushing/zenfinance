import Anthropic from '@anthropic-ai/sdk';
import type { ChatFactView } from '@zenfinance/shared';
import { z } from 'zod';
import { env } from '../env.js';

export interface GroundedChatDraft {
  answer: string;
  facts: ChatFactView[];
  actions: string[];
}

const responseSchema = z.object({
  answer: z.string().min(1).max(2000),
  fact_indexes: z.array(z.number().int().nonnegative()).max(12),
  actions: z.array(z.string().min(1).max(300)).min(1).max(3),
});

const CHAT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answer: { type: 'string', minLength: 1, maxLength: 2000 },
    fact_indexes: {
      type: 'array',
      maxItems: 12,
      items: { type: 'integer', minimum: 0 },
    },
    actions: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: { type: 'string', minLength: 1, maxLength: 300 },
    },
  },
  required: ['answer', 'fact_indexes', 'actions'],
} as const;

const CHAT_SYSTEM_PROMPT = `You are Zen, a calm, concise personal-finance coach. Answer the user's actual question using only the supplied, server-computed financial context.

Rules:
- Never invent a transaction, merchant, balance, goal, date, percentage, or dollar amount.
- You may mention a dollar amount only when it appears verbatim in an available fact or in the deterministic draft. Do not perform new arithmetic.
- Select fact_indexes only from the available facts that directly support the answer.
- If the context cannot answer the question, say exactly what data is missing and suggest a useful next step. Do not substitute a generic weekly brief.
- Spending and saving education only. No investment, tax, legal, credit-repair, or debt-settlement advice.
- No shame, fear, certainty claims, or markdown. Keep the answer under 140 words and return 1-3 concrete actions.
- Return JSON matching the required schema.`;

function dollarAmounts(text: string): number[] {
  return [...text.matchAll(/\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g)].map((match) =>
    Math.round(Number(match[1]!.replace(/,/g, '')) * 100),
  );
}

export async function generateGroundedChatAnswer(
  question: string,
  draft: GroundedChatDraft,
  availableFacts: ChatFactView[],
  contextSummary: object,
): Promise<GroundedChatDraft> {
  if (env.CHAT_PROVIDER === 'mock') return draft;
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured for CHAT_PROVIDER=anthropic');

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 15_000 });
  const response = await client.messages.create({
    model: env.CHAT_MODEL,
    max_tokens: 900,
    system: CHAT_SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: CHAT_JSON_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          question,
          deterministic_draft: draft,
          available_facts: availableFacts.map((fact, index) => ({ index, ...fact })),
          context: contextSummary,
        }),
      },
    ],
  });

  if (response.stop_reason === 'refusal') throw new Error('chat model refused the request');
  const text = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text')?.text ?? '';
  const parsed = responseSchema.parse(JSON.parse(text));
  const indexes = [...new Set(parsed.fact_indexes)].filter((index) => index < availableFacts.length);
  const allowedAmounts = new Set([
    ...availableFacts.flatMap((fact) => (fact.amountCents === null ? [] : [Math.abs(fact.amountCents)])),
    ...dollarAmounts(`${draft.answer} ${draft.actions.join(' ')}`),
  ]);
  const generatedAmounts = dollarAmounts(`${parsed.answer} ${parsed.actions.join(' ')}`);
  if (generatedAmounts.some((amount) => !allowedAmounts.has(Math.abs(amount)))) {
    throw new Error('chat model returned an ungrounded dollar amount');
  }

  return {
    answer: parsed.answer,
    facts: indexes.map((index) => availableFacts[index]!),
    actions: parsed.actions,
  };
}
