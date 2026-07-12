// Merchant name cleanup and normalization shared by the mock provider, the
// fallback path, and recurring-stream detection (which needs a stable key to
// group repeat charges from the same merchant by).

const TRAILING_STORE_NUMBER = /\s*#?\d{4,}$/;
const TRAILING_REFERENCE = /\s+\d{3,}[a-z0-9]*$/i;
const WEB_SUFFIXES = /\.(com|net)\b/gi;
const PENDING_MARKER = /\s*\(pending\)\s*/gi;
const MULTI_SPACE = /\s+/g;
const NON_ALNUM = /[^a-z0-9]+/g;

const SMALL_WORDS = new Set(['and', 'of', 'the', 'llc', 'inc']);
const KEEP_UPPER = new Set(['ATM', 'ACH', 'ATT', 'AT&T']);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word, i) => {
      const upper = word.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;
      if (i > 0 && SMALL_WORDS.has(word)) return word;
      return word[0]!.toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Derive a clean, display-ready merchant name from the raw provider strings.
 * Prefers Plaid's own `merchantName` when it looks trustworthy; otherwise
 * strips store numbers, reference codes, ".COM" suffixes, and pending
 * markers from the raw transaction name, then title-cases the result.
 */
export function cleanMerchantName(rawName: string, merchantName: string | null): string {
  const source = merchantName && merchantName.trim().length > 0 ? merchantName : rawName;
  const cleaned = source
    .replace(PENDING_MARKER, '')
    .replace(WEB_SUFFIXES, '')
    .replace(TRAILING_STORE_NUMBER, '')
    .replace(TRAILING_REFERENCE, '')
    .replace(MULTI_SPACE, ' ')
    .trim();
  return cleaned.length > 0 ? titleCase(cleaned) : titleCase(source.trim());
}

/** Stable lowercase key for grouping "same merchant" across transactions. */
export function merchantKey(rawName: string, merchantName: string | null): string {
  const clean = cleanMerchantName(rawName, merchantName);
  return clean.toLowerCase().replace(NON_ALNUM, '');
}
