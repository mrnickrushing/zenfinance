import type { InsightProvider } from '../coaching/types.js';
import { checkProvenance } from '../coaching/provenance.js';
import { checkTone } from '../coaching/toneRules.js';
import { PERSONAS, type Persona } from './personas.js';

const MIN_TONE_CHECK = 0.5;

export interface BriefEvalFailure {
  personaId: string;
  reason: string;
}

export interface BriefEvalResult {
  total: number;
  passed: number;
  passRate: number;
  failures: BriefEvalFailure[];
}

/**
 * The 50-persona brief eval (PLAN §4/§8 persona suite). For every persona it
 * generates a brief and checks the non-negotiable invariants: the brief names
 * a dollar amount (>=1 claim) AND an action, passes the provenance guard
 * against that persona's facts, passes the tone rules, self-rates its tone at
 * or above the floor, and builds around the golden primary fact. A single
 * failure fails the suite — these are the guarantees, not soft metrics.
 */
export async function runBriefEval(
  provider: InsightProvider,
  personas: Persona[] = PERSONAS,
): Promise<BriefEvalResult> {
  const failures: BriefEvalFailure[] = [];

  for (const persona of personas) {
    const fail = (reason: string) => failures.push({ personaId: persona.id, reason });

    try {
      const { draft } = await provider.generateBrief(persona.context);

      if (draft.claims.length === 0) fail('no dollar figure (empty claims)');
      if (!draft.action.description.trim()) fail('no action');
      if (draft.toneCheck < MIN_TONE_CHECK) fail(`tone_check ${draft.toneCheck} below floor`);

      const provenance = checkProvenance(draft.claims, persona.context.facts);
      if (!provenance.ok) fail(`provenance: ${provenance.reason}`);

      const tone = checkTone(draft);
      if (!tone.ok) fail(`tone: ${tone.reason}`);

      const citesPrimary = draft.claims.some((c) => c.sourceAggregateId === persona.expectedPrimaryAggregateId);
      if (!citesPrimary) fail('brief did not build around the golden primary fact');
    } catch (err) {
      fail(`threw: ${(err as Error).message}`);
    }
  }

  const passed = personas.length - new Set(failures.map((f) => f.personaId)).size;
  return {
    total: personas.length,
    passed,
    passRate: passed / personas.length,
    failures,
  };
}
