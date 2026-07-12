import type { CoachingContext } from './types.js';

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// The coaching policy prompt (§4 guardrails). Deliberately prescriptive about
// provenance and tone because those are enforced by post-generation guards —
// the prompt and the guards must agree.
export const COACHING_SYSTEM_PROMPT = `You are ZenFinance, a calm, plain-English personal finance coach. You turn a user's own spending data into one short, encouraging, actionable brief.

Non-negotiable rules:
- Every brief must name a specific dollar amount AND a concrete next action. If a screen doesn't tell the user what to DO, it doesn't ship.
- You may ONLY cite dollar figures that appear in the provided FACTS list, and you must cite each one by its exact aggregate_id. Never invent, estimate, or compute a dollar figure for the "claims" array — those are verified figures. Do not do arithmetic; every number you cite must come verbatim from a FACT.
- The action's "estimated_impact_usd" is the ONE place a forward-looking estimate is allowed. It is a projection, not a verified figure, and will be labeled "estimated" in the app. Keep it grounded in the facts (e.g. a fraction of a real discretionary category). It may be null if no honest estimate fits.
- Tone: calm and progress-framed ("you freed up $120"), never deficit-framed or shaming. Forbidden: shame or judgment language, telling the user they are bad with money, or implying they can't afford their life.
- Scope: you are NOT a licensed advisor. Never give investment, tax, brokerage, or legal advice. No "invest in X", no "this is tax-deductible", no stock/crypto picks. Coaching on spending and saving only.
- Be concise: headline under 90 characters, body 2-4 short sentences.

Output ONLY the JSON object matching the provided schema. "tone_check" is your own 0-1 self-rating of how well this brief meets the calm/encouraging tone bar.`;

// Wire schema uses dollars (amount_usd / estimated_impact_usd) as the plan
// specifies; the provider converts to integer cents. All non-null.
export const BRIEF_JSON_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    body: { type: 'string' },
    action: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        estimated_impact_usd: { type: ['number', 'null'] },
        timeframe: { type: 'string' },
      },
      required: ['description', 'estimated_impact_usd', 'timeframe'],
      additionalProperties: false,
    },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          amount_usd: { type: 'number' },
          source_aggregate_id: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['amount_usd', 'source_aggregate_id', 'label'],
        additionalProperties: false,
      },
    },
    tone_check: { type: 'number' },
  },
  required: ['headline', 'body', 'action', 'claims', 'tone_check'],
  additionalProperties: false,
};

/** Render the deterministic context into the compact user message the model sees. */
export function renderContextMessage(context: CoachingContext): string {
  const lines: string[] = [];
  lines.push(
    context.kind === 'first_look'
      ? "This is the user's FIRST brief, generated right after they linked their accounts (90 days of history). Make it a warm, high-signal first impression."
      : 'This is the weekly brief.',
  );
  lines.push('');

  if (context.profile.discretionaryRatio !== null) {
    lines.push(`Discretionary share of spending (latest week): ${(context.profile.discretionaryRatio * 100).toFixed(0)}%`);
  }
  if (context.profile.hasIncome) {
    lines.push(`Recent average weekly net (income minus spending): ${usd(context.profile.recentWeeklyNetCents)}`);
  }
  lines.push('');

  if (context.goals.length > 0) {
    lines.push('GOALS:');
    for (const g of context.goals) {
      const pace =
        g.pacingStatus === 'on_track'
          ? 'on track'
          : g.pacingStatus === 'behind'
            ? 'behind pace'
            : g.pacingStatus === 'ahead'
              ? 'reached'
              : g.pacingStatus === 'no_deadline'
                ? 'no deadline'
                : 'pace unknown';
      const weekly = g.weeklyTargetCents !== null ? ` — need ${usd(g.weeklyTargetCents)}/week to hit the date` : '';
      lines.push(`- ${g.name}: ${usd(g.currentAmountCents)} of ${usd(g.targetAmountCents)} (${pace})${weekly}`);
    }
    lines.push('');
  }

  if (context.topDiscretionaryCategories.length > 0) {
    lines.push('TOP DISCRETIONARY CATEGORIES (latest week):');
    for (const c of context.topDiscretionaryCategories) {
      const delta =
        c.deltaCents === null ? '' : ` (${c.deltaCents >= 0 ? 'up' : 'down'} ${usd(Math.abs(c.deltaCents))} vs last week)`;
      lines.push(`- ${c.label}: ${usd(c.amountCents)}${delta}`);
    }
    lines.push('');
  }

  if (context.recurringCharges.length > 0) {
    lines.push('RECURRING CHARGES:');
    for (const r of context.recurringCharges) {
      lines.push(`- ${r.merchantClean}: ${usd(r.avgAmountCents)} ${r.cadence}`);
    }
    lines.push('');
  }

  if (context.anomalies.length > 0) {
    lines.push('NOTABLE EVENTS:');
    for (const a of context.anomalies) {
      lines.push(`- ${a.title}: ${a.detail} (${usd(a.amountCents)})`);
    }
    lines.push('');
  }

  lines.push('FACTS (the ONLY figures you may cite, each with its aggregate_id):');
  for (const f of context.facts) {
    lines.push(`- aggregate_id=${f.aggregateId} | ${f.label} | ${usd(f.amountCents)}`);
  }

  return lines.join('\n');
}
