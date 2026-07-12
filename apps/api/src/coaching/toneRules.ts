import type { BriefDraft } from './types.js';

export interface ToneResult {
  ok: boolean;
  reason: string | null;
}

// Banned phrases: shame/judgment language and out-of-scope advice (§4
// guardrails). Matched case-insensitively as substrings/word-boundaries over
// the brief's user-facing text. This is a lightweight, high-precision floor —
// the coaching-policy prompt is the primary control; this catches regressions.
const BANNED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Shame / judgment
  { pattern: /\bashamed\b/i, reason: 'shame language' },
  { pattern: /\birresponsible\b/i, reason: 'judgment language' },
  { pattern: /\bwasting\b|\bwasted your\b|\byou waste\b/i, reason: 'shame language' },
  { pattern: /\byou can'?t afford\b/i, reason: 'deficit-framed language' },
  { pattern: /\bbad with money\b/i, reason: 'judgment language' },
  { pattern: /\bstop being\b/i, reason: 'judgment language' },
  { pattern: /\byou should be (embarrassed|ashamed)\b/i, reason: 'shame language' },
  { pattern: /\bfinancially reckless\b|\breckless spending\b/i, reason: 'judgment language' },
  { pattern: /\bout of control\b/i, reason: 'judgment language' },
  // Out-of-scope advice
  { pattern: /\binvest in\b|\byou should invest\b|\binvesting in\b/i, reason: 'investment advice' },
  { pattern: /\bbuy (stocks?|crypto|bitcoin|shares)\b/i, reason: 'investment advice' },
  { pattern: /\btax(-| )deductib/i, reason: 'tax advice' },
  { pattern: /\bwrite it off\b|\bwrite this off\b/i, reason: 'tax advice' },
  { pattern: /\bconsult (a|your) (lawyer|attorney)\b|\blegal advice\b/i, reason: 'legal advice' },
  { pattern: /\bportfolio\b|\bbrokerage\b|\bmutual fund\b|\bindex fund\b|\betf\b|\b401\(?k\)?\b|\broth ira\b/i, reason: 'investment advice' },
];

/** Scan a brief's user-facing text for banned phrases (§4 rules pass). */
export function checkTone(draft: BriefDraft): ToneResult {
  const haystack = [draft.headline, draft.body, draft.action.description].join('\n');
  for (const { pattern, reason } of BANNED_PATTERNS) {
    if (pattern.test(haystack)) {
      return { ok: false, reason: `banned phrase (${reason})` };
    }
  }
  return { ok: true, reason: null };
}
