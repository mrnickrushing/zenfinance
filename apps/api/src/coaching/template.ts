import type { BriefDraft, CitableFact, CoachingContext } from './types.js';

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Pick the figure a brief should be built around: the largest discretionary
 * category if there is one (that's where coaching has leverage), otherwise the
 * largest citable fact of any kind. Returns null only when there is nothing to
 * cite — in which case no brief should be generated at all.
 */
export function pickPrimaryFact(context: CoachingContext): CitableFact | null {
  const categorySpend = context.facts
    .filter((f) => f.kind === 'category_spend')
    .sort((a, b) => b.amountCents - a.amountCents);
  if (categorySpend.length > 0) return categorySpend[0]!;
  const anySpend = context.facts
    .filter((f) => f.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents);
  return anySpend[0] ?? context.facts[0] ?? null;
}

/**
 * Deterministic template fallback (§4: invalid model output → retry → fall
 * back to a template insight). Minimal but honest — it still names a real
 * dollar figure (cited for provenance) and a concrete action, and it always
 * passes the tone rules. Returns null when there are no facts to cite.
 */
export function generateTemplateBrief(context: CoachingContext): BriefDraft | null {
  const primary = pickPrimaryFact(context);
  if (!primary) return null;

  const categoryName = primary.label.replace(/ spend this week$/i, '');
  const suggestedCut = Math.max(500, Math.round(primary.amountCents * 0.15));
  const activeGoal = context.goals.find((g) => g.remainingAmountCents > 0) ?? null;

  const goalLine = activeGoal
    ? ` Money you free up here goes straight toward "${activeGoal.name}".`
    : ' Small, painless swaps add up over a month.';

  return {
    headline: `${categoryName} was ${usd(primary.amountCents)} this week`,
    body: `${categoryName} was one of your bigger flexible expenses this week.${goalLine} No need to cut it out — just trim a little.`,
    action: {
      description: `Aim to spend about ${usd(suggestedCut)} less on ${categoryName.toLowerCase()} next week — one swap is enough to start.`,
      estimatedImpactCents: suggestedCut,
      timeframe: 'next week',
    },
    claims: [
      { amountCents: primary.amountCents, sourceAggregateId: primary.aggregateId, label: primary.label },
    ],
    toneCheck: 0.8,
  };
}
