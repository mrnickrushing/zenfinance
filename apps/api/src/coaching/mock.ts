import type { BriefClaim, BriefDraft, CoachingContext, InsightProvider } from './types.js';
import { pickPrimaryFact } from './template.js';

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Deterministic insight provider — the offline/CI/dev stand-in for the real
 * Sonnet coach (INSIGHT_PROVIDER=mock). Not a stub: it produces a genuinely
 * useful, provenance-clean, tone-clean brief from the assembled context —
 * richer than the template fallback (it uses week-over-week deltas, ties the
 * action to an active goal, and calls out a notable event when present). It
 * exercises the full happy path so tests cover the guards, not just the code
 * that skips them.
 */
export class MockInsightProvider implements InsightProvider {
  readonly name = 'mock';
  readonly model = 'mock-coach-v1';

  async generateBrief(context: CoachingContext): Promise<{ draft: BriefDraft; usage: null }> {
    const primary = pickPrimaryFact(context);
    if (!primary) {
      // Should never happen — the pipeline only calls a provider when facts
      // exist — but produce a claim-less draft so the guard fails loudly
      // rather than emitting a fabricated figure.
      return {
        draft: {
          headline: 'Your first look is almost ready',
          body: 'We need a little more transaction history before your first brief.',
          action: { description: 'Check back after your next few transactions sync.', estimatedImpactCents: null, timeframe: 'soon' },
          claims: [],
          toneCheck: 0.5,
        },
        usage: null,
      };
    }

    const category = context.topDiscretionaryCategories.find((c) => c.aggregateId === primary.aggregateId) ?? null;
    const categoryName = primary.label.replace(/ spend this week$/i, '');
    const claims: BriefClaim[] = [
      { amountCents: primary.amountCents, sourceAggregateId: primary.aggregateId, label: primary.label },
    ];

    // Week-over-week delta framing (cite the delta fact when present).
    let trendSentence = '';
    if (category && category.deltaCents !== null && category.deltaAggregateId !== null && Math.abs(category.deltaCents) >= 500) {
      const up = category.deltaCents > 0;
      trendSentence = up
        ? ` That's ${usd(Math.abs(category.deltaCents))} more than last week.`
        : ` Nice — that's ${usd(Math.abs(category.deltaCents))} less than last week.`;
      claims.push({
        amountCents: Math.abs(category.deltaCents),
        sourceAggregateId: category.deltaAggregateId,
        label: `${categoryName} change vs last week`,
      });
    }

    // Goal-linked framing.
    const activeGoal = context.goals.find((g) => g.remainingAmountCents > 0) ?? null;
    const suggestedCut = Math.max(500, Math.round(primary.amountCents * 0.15));
    const goalSentence = activeGoal
      ? ` Redirecting a bit of this toward "${activeGoal.name}" keeps that goal moving.`
      : '';

    // Notable-event mention (does not add a claim unless it's the primary).
    const topAnomaly = context.anomalies[0] ?? null;
    const eventSentence = topAnomaly ? ` Heads up: ${topAnomaly.title.toLowerCase()}.` : '';

    const intro =
      context.kind === 'first_look'
        ? `Welcome to ZenFinance. Looking at your last few weeks, ${categoryName.toLowerCase()} stands out at ${usd(primary.amountCents)}.`
        : `${categoryName} came to ${usd(primary.amountCents)} this week.`;

    return {
      draft: {
        headline: `${categoryName}: ${usd(primary.amountCents)} this week`,
        body: `${intro}${trendSentence}${goalSentence}${eventSentence} It's one of your most flexible categories, so it's the easiest place to free up money.`,
        action: {
          description: `Try trimming ${categoryName.toLowerCase()} by about ${usd(suggestedCut)} next week — one swap, like one fewer takeout night, does it.`,
          estimatedImpactCents: suggestedCut,
          timeframe: 'next week',
        },
        claims,
        toneCheck: 0.92,
      },
      usage: null,
    };
  }
}
