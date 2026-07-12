import type { BriefClaim, CitableFact } from './types.js';

export interface ProvenanceResult {
  ok: boolean;
  reason: string | null;
}

// Tolerance absorbs the model rounding a real figure (e.g. citing "$450" for a
// $450.23 fact) without letting a genuinely different number through.
function tolerance(factCents: number): number {
  return Math.max(100, Math.round(Math.abs(factCents) * 0.02));
}

/**
 * §4 provenance guard. Every verified claim must cite an aggregate_id that
 * exists in the provided facts, and its amount must match that fact's amount.
 * Because the id binds the figure to one specific labeled fact, the model
 * cannot fabricate a number or pin a real number onto a fact whose amount
 * differs (the "reuse a valid $45 against the wrong merchant" failure needs a
 * different id, whose amount then won't match). A brief with no claims fails —
 * every brief must cite at least one real figure.
 */
export function checkProvenance(claims: BriefClaim[], facts: CitableFact[]): ProvenanceResult {
  if (claims.length === 0) {
    return { ok: false, reason: 'no claims — every brief must cite at least one verified figure' };
  }
  const byId = new Map(facts.map((f) => [f.aggregateId, f]));
  for (const claim of claims) {
    const fact = byId.get(claim.sourceAggregateId);
    if (!fact) {
      return { ok: false, reason: `claim cites unknown aggregate_id ${claim.sourceAggregateId}` };
    }
    if (Math.abs(claim.amountCents - fact.amountCents) > tolerance(fact.amountCents)) {
      return {
        ok: false,
        reason: `claim amount ${claim.amountCents} does not match fact ${fact.aggregateId} (${fact.amountCents})`,
      };
    }
  }
  return { ok: true, reason: null };
}
