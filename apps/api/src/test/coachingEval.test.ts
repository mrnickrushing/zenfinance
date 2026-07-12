import { describe, expect, it } from 'vitest';
import { MockInsightProvider } from '../coaching/mock.js';
import { checkProvenance } from '../coaching/provenance.js';
import { generateTemplateBrief } from '../coaching/template.js';
import { checkTone } from '../coaching/toneRules.js';
import { PERSONAS } from '../eval/personas.js';
import { runBriefEval } from '../eval/runBriefEval.js';

describe('Phase 3 exit gate: 50-persona brief suite', () => {
  it('has 50 personas', () => {
    expect(PERSONAS.length).toBe(50);
  });

  it('every persona passes the coach (dollar + action + provenance + tone + golden primary)', async () => {
    const result = await runBriefEval(new MockInsightProvider());
    // A single failure fails the suite — these are guarantees, not a metric.
    if (result.failures.length > 0) {
      console.error('persona failures:', result.failures.slice(0, 20));
    }
    expect(result.passRate).toBe(1);
    expect(result.passed).toBe(50);
  });

  it('every persona also passes through the deterministic template fallback', () => {
    for (const p of PERSONAS) {
      const draft = generateTemplateBrief(p.context);
      expect(draft, `${p.id}: template returned null`).not.toBeNull();
      expect(draft!.claims.length).toBeGreaterThan(0);
      expect(draft!.action.description.trim().length).toBeGreaterThan(0);
      expect(checkProvenance(draft!.claims, p.context.facts).ok, `${p.id} provenance`).toBe(true);
      expect(checkTone(draft!).ok, `${p.id} tone`).toBe(true);
    }
  });
});

describe('Phase 3 guards reject bad briefs', () => {
  it('provenance rejects a fabricated figure', () => {
    const facts = [{ aggregateId: 'a', amountCents: 4500, label: 'Dining', kind: 'category_spend' as const }];
    const bad = checkProvenance([{ amountCents: 9999, sourceAggregateId: 'a', label: 'Dining' }], facts);
    expect(bad.ok).toBe(false);
    const unknownId = checkProvenance([{ amountCents: 4500, sourceAggregateId: 'nope', label: 'x' }], facts);
    expect(unknownId.ok).toBe(false);
    const noClaims = checkProvenance([], facts);
    expect(noClaims.ok).toBe(false);
    const good = checkProvenance([{ amountCents: 4500, sourceAggregateId: 'a', label: 'Dining' }], facts);
    expect(good.ok).toBe(true);
  });

  it('tone rules reject shame and out-of-scope advice', () => {
    const base = {
      action: { description: 'do a thing', estimatedImpactCents: 100, timeframe: 'now' },
      claims: [],
      toneCheck: 0.9,
    };
    expect(checkTone({ ...base, headline: 'You are irresponsible', body: 'ok' }).ok).toBe(false);
    expect(checkTone({ ...base, headline: 'ok', body: 'You should invest in index funds' }).ok).toBe(false);
    expect(checkTone({ ...base, headline: 'You freed up $45', body: 'Nice work this week.' }).ok).toBe(true);
  });
});
