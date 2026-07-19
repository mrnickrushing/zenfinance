import Anthropic from '@anthropic-ai/sdk';
import type { ChatFactView } from '@zenfinance/shared';
import { z } from 'zod';
import { env } from '../env.js';

export interface GroundedChatDraft {
  answer: string;
  facts: ChatFactView[];
  actions: string[];
}

export interface GroundedChatOptions {
  timeoutMs?: number;
  maxRetries?: number;
  maxTokens?: number;
}

const responseSchema = z.object({
  answer: z.string().min(1).max(3000),
  fact_indexes: z.array(z.number().int().nonnegative()).max(12),
  actions: z.array(z.string().min(1).max(300)).min(1).max(6),
});

// Anthropic's structured-output JSON schema rejects numeric/string/array length
// constraints (minimum, minLength, maxLength, minItems, maxItems) with a 400.
// Keep the wire schema to types/required/additionalProperties only; responseSchema
// above still enforces the real length/count limits on the parsed response below.
const CHAT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answer: { type: 'string' },
    fact_indexes: {
      type: 'array',
      items: { type: 'integer' },
    },
    actions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['answer', 'fact_indexes', 'actions'],
} as const;

const CHAT_SYSTEM_PROMPT = `You are Zen, a calm, concise personal-finance coach. Answer the user's actual question using only the supplied, server-computed financial context.

Rules:
- Never invent a transaction, merchant, balance, goal, date, percentage, or dollar amount.
- You may mention a dollar amount only when it appears verbatim in an available fact or the deterministic draft, is the sum of two such amounts you cite in fact_indexes, or is one of those amounts converted to its annual (×12) or quarterly (×4) equivalent. Do not invent or estimate any other number.
- Select fact_indexes only from the available facts that directly support the answer, including any facts you combine into a derived sum or annual/quarterly figure.
- If the context cannot answer the question, say exactly what data is missing and suggest a useful next step. Do not substitute a generic weekly brief.
- Spending and saving education only. No investment, tax, legal, credit-repair, or debt-settlement advice.
- No shame, fear, certainty claims, or markdown.
- For a simple question, keep the answer under 140 words and return 1-3 concrete actions.
- If the user explicitly asks for a plan, breakdown, step-by-step instructions, or multiple options, give a real answer with that structure: you may use up to 400 words and up to 6 concrete, sequential actions. Do not compress a requested plan back down to a generic summary.
- Return JSON matching the required schema.`;

function dollarAmounts(text: string): number[] {
  return [
    ...text.matchAll(
      /(?:\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:dollars?|usd)\b)/gi,
    ),
  ].map((match) => Math.round(Number((match[1] ?? match[2])!.replace(/,/g, '')) * 100));
}

/** Expands grounded cents amounts with simple derived math (sums, monthly<->annual/quarterly) an LLM may legitimately compute. */
function expandedAllowedAmounts(baseAmounts: number[]): Set<number> {
  const allowed = new Set<number>(baseAmounts);
  for (let i = 0; i < baseAmounts.length; i++) {
    allowed.add(baseAmounts[i]! * 12);
    allowed.add(baseAmounts[i]! * 4);
    for (let j = i + 1; j < baseAmounts.length; j++) {
      allowed.add(baseAmounts[i]! + baseAmounts[j]!);
    }
  }
  return allowed;
}

/** Allows amounts within a $1 rounding tolerance of a grounded or derived amount. */
function amountIsGrounded(amountCents: number, allowed: Set<number>): boolean {
  const target = Math.abs(amountCents);
  for (const allowedAmount of allowed) {
    if (Math.abs(target - allowedAmount) <= 100) return true;
  }
  return false;
}

export async function generateGroundedChatAnswer(
  question: string,
  draft: GroundedChatDraft,
  availableFacts: ChatFactView[],
  contextSummary: object,
  options: GroundedChatOptions = {},
): Promise<GroundedChatDraft> {
  if (env.CHAT_PROVIDER === 'mock') return draft;
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured for CHAT_PROVIDER=anthropic');

  // Bound worst-case latency: the SDK's default of 2 retries could otherwise stack
  // up to 3 full attempts behind the mobile client's request timeout.
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: options.timeoutMs ?? 15_000,
    maxRetries: options.maxRetries ?? 1,
  });
  const response = await client.messages.create({
    model: env.CHAT_MODEL,
    max_tokens: options.maxTokens ?? 2400,
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
  if (parsed.fact_indexes.some((index) => index >= availableFacts.length)) {
    throw new Error('chat model returned an invalid fact index');
  }
  const indexes = [...new Set(parsed.fact_indexes)];
  const draftAmounts = dollarAmounts(`${draft.answer} ${draft.actions.join(' ')}`);
  // Verbatim mentions may draw on any available fact; derived math (sums, x12/x4)
  // is restricted to facts the model actually cited, so it can't combine unrelated
  // amounts from the broader merged context into a fabricated total.
  const verbatimAmounts = new Set([
    ...availableFacts.flatMap((fact) => (fact.amountCents === null ? [] : [Math.abs(fact.amountCents)])),
    ...draftAmounts,
  ]);
  const citedAmounts = indexes.flatMap((index) => {
    const amount = availableFacts[index]!.amountCents;
    return amount === null ? [] : [Math.abs(amount)];
  });
  const derivedAmounts = expandedAllowedAmounts([...citedAmounts, ...draftAmounts]);
  const allowedAmounts = new Set([...verbatimAmounts, ...derivedAmounts]);
  const generatedAmounts = dollarAmounts(`${parsed.answer} ${parsed.actions.join(' ')}`);
  if (generatedAmounts.some((amount) => !amountIsGrounded(amount, allowedAmounts))) {
    throw new Error('chat model returned an ungrounded dollar amount');
  }

  return {
    answer: parsed.answer,
    facts: indexes.map((index) => availableFacts[index]!),
    actions: parsed.actions,
  };
}
