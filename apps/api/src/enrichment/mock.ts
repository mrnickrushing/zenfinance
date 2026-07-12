import { defaultDiscretionaryFor } from './categories.js';
import { mapProviderCategoryToTaxonomy } from './fallback.js';
import { cleanMerchantName } from './textNormalize.js';
import type {
  EnrichmentBatchResult,
  EnrichmentInput,
  EnrichmentProvider,
  EnrichmentResult,
  FewShotExample,
} from './types.js';

interface Rule {
  pattern: RegExp;
  category: string;
  recurring?: boolean;
  confidence: number;
}

// Deterministic keyword classifier: the offline/CI/dev provider (no API key
// required), and the pipeline's runtime provider when ENRICHMENT_PROVIDER=mock.
// Ordered — first match wins, so more specific patterns (a named fast-food
// chain) are listed ahead of broad category words (generic "restaurant").
const RULES: Rule[] = [
  // Coffee
  { pattern: /starbucks|peet'?s|blue bottle|dunkin|coffee|caribou coffee/i, category: 'COFFEE_SHOPS', confidence: 0.92 },
  // Fast food (checked before general dining)
  {
    pattern:
      /mcdonald|burger king|wendy'?s|taco bell|chick-?fil-?a|chipotle|\bkfc\b|popeyes|sonic drive|arby'?s|domino'?s|pizza hut|panera|five guys|in-?n-?out|shake shack|subway(?! transit)/i,
    category: 'FAST_FOOD',
    confidence: 0.9,
  },
  // Delivery apps + general dining
  {
    pattern:
      /uber eats|doordash|grubhub|postmates|seamless|olive garden|cheesecake factory|bistro|\bgrill\b|\bdiner\b|kitchen|taqueria|sushi|steakhouse|restaurant|trattoria|pizzeria/i,
    category: 'RESTAURANTS_AND_DINING',
    confidence: 0.85,
  },
  // Bars / alcohol
  { pattern: /\bbar\b|\bpub\b|brewery|winery|liquor|tavern|spirits|taproom/i, category: 'BARS_AND_ALCOHOL', confidence: 0.85 },
  // Groceries
  {
    pattern: /whole foods|whole ?fds|trader joe|safeway|kroger|\baldi\b|publix|wegmans|sprouts|grocery|supermarket|\bfoods?\b market/i,
    category: 'GROCERIES',
    confidence: 0.88,
  },
  // Gas & fuel
  {
    pattern: /shell oil|chevron|exxon|\bmobil\b|\bbp\b|arco|circle k|speedway|gas station|fuel/i,
    category: 'GAS_AND_FUEL',
    confidence: 0.88,
  },
  // Rideshare / taxi (not the sandwich chain)
  { pattern: /\buber\b(?! eats)|\blyft\b|\btaxi\b|\bcab\b/i, category: 'RIDESHARE_AND_TAXI', confidence: 0.88 },
  // Public transit
  { pattern: /\bmta\b|\bbart\b|transit authority|\bmuni\b|metro card|metro transit|subway transit/i, category: 'PUBLIC_TRANSIT', confidence: 0.85 },
  // Auto maintenance
  { pattern: /jiffy lube|autozone|firestone|\bmidas\b|tire (shop|center)|oil change|auto repair|mechanic/i, category: 'AUTO_MAINTENANCE', confidence: 0.85 },
  // Parking & tolls
  { pattern: /parking|\btoll\b|ezpass|e-?zpass|garage ramp/i, category: 'PARKING_AND_TOLLS', confidence: 0.85 },
  // Subscriptions & streaming
  {
    pattern: /netflix|\bhulu\b|spotify|disney\+|\bhbo\b|youtube premium|amazon prime|patreon|apple\.com\/bill|icloud/i,
    category: 'SUBSCRIPTIONS_AND_STREAMING',
    recurring: true,
    confidence: 0.92,
  },
  // Fitness & gym
  { pattern: /planet fitness|\bequinox\b|\byoga\b|peloton|crossfit|\bgym\b|fitness club/i, category: 'FITNESS_AND_GYM', recurring: true, confidence: 0.85 },
  // Personal care
  { pattern: /\bsalon\b|barber|\bspa\b|nail(s)? bar|hair studio/i, category: 'PERSONAL_CARE', confidence: 0.82 },
  // Clothing
  { pattern: /nordstrom|\bgap\b|\bh&m\b|\bzara\b|macy'?s|\bnike\b|uniqlo|ann taylor|old navy|clothing/i, category: 'CLOTHING', confidence: 0.85 },
  // Electronics
  { pattern: /best buy|apple store|micro center|gamestop|electronics/i, category: 'ELECTRONICS', confidence: 0.85 },
  // Home improvement
  { pattern: /home depot|lowe'?s|ace hardware|hardware store/i, category: 'HOME_IMPROVEMENT', confidence: 0.86 },
  // Home goods
  { pattern: /\bikea\b|homegoods|bed bath|container store|wayfair|pottery barn|crate ?& ?barrel/i, category: 'HOME_GOODS', confidence: 0.85 },
  // Utilities
  { pattern: /\bpg&e\b|con ?ed|electric (co|company|utility)|water dept|water utility|gas company|utility bill/i, category: 'UTILITIES', recurring: true, confidence: 0.88 },
  // Internet & phone
  { pattern: /comcast|xfinity|\bat&t\b|verizon|t-?mobile|spectrum internet|internet service/i, category: 'INTERNET_AND_PHONE', recurring: true, confidence: 0.88 },
  // Insurance
  { pattern: /geico|state farm|progressive ins|allstate|insurance premium|insurance co/i, category: 'INSURANCE', recurring: true, confidence: 0.88 },
  // Pharmacy (before generic healthcare)
  { pattern: /\bcvs\b|walgreens|rite aid|pharmacy/i, category: 'PHARMACY', confidence: 0.85 },
  // Pet care (before generic healthcare — "veterinary clinic" would otherwise
  // match the "clinic" keyword below)
  { pattern: /\bpetco\b|petsmart|veterinary|\bvet clinic\b/i, category: 'PET_CARE', confidence: 0.85 },
  // Healthcare
  { pattern: /hospital|clinic|medical center|dental|dentist|doctor|urgent care/i, category: 'HEALTHCARE', confidence: 0.85 },
  // Childcare
  { pattern: /daycare|child ?care|preschool/i, category: 'CHILDCARE', confidence: 0.85 },
  // Education
  { pattern: /tuition|university|college|school district/i, category: 'EDUCATION', confidence: 0.85 },
  // Gifts & charity
  { pattern: /donation|\bcharity\b|gofundme|red cross|non-?profit/i, category: 'CHARITY', confidence: 0.8 },
  // Fees
  { pattern: /overdraft fee|atm fee|service charge|maintenance fee|late fee|nsf fee/i, category: 'FEES_AND_CHARGES', confidence: 0.9 },
  // Rent / mortgage
  { pattern: /\brent\b|mortgage|property management|apartments? llc/i, category: 'RENT_OR_MORTGAGE', recurring: true, confidence: 0.88 },
  // Travel & lodging
  { pattern: /airlines?|delta air|united air|southwest air|marriott|hilton|airbnb|\bhotel\b|expedia/i, category: 'TRAVEL_AND_LODGING', confidence: 0.85 },
  // Taxes
  { pattern: /\birs\b|tax payment|state tax|franchise tax/i, category: 'TAXES', confidence: 0.85 },
  // Auto payment (loan/lease on a vehicle — checked before the generic loan
  // pattern below, since "auto loan payment" would otherwise match "loan
  // payment" first)
  { pattern: /auto (loan|lease) payment|vehicle payment/i, category: 'AUTO_PAYMENT', recurring: true, confidence: 0.85 },
  // Loan payment
  { pattern: /student loan|sallie mae|navient|loan (pmt|payment)/i, category: 'LOAN_PAYMENT', recurring: true, confidence: 0.85 },
  // Credit card payment
  { pattern: /credit card payment|payment.*thank you|autopay/i, category: 'CREDIT_CARD_PAYMENT', recurring: true, confidence: 0.85 },
  // Savings & investment
  { pattern: /vanguard|fidelity investments|robinhood|401k|ira contribution/i, category: 'SAVINGS_AND_INVESTMENT', confidence: 0.8 },
  // Income
  { pattern: /payroll|direct dep|salary|paycheck/i, category: 'INCOME', confidence: 0.92 },
  // Transfers (own-account moves, P2P apps)
  { pattern: /online transfer|\bzelle\b|venmo|cash app|\btransfer to\b|\btransfer from\b/i, category: 'TRANSFER', confidence: 0.8 },
  // General merchandise (big-box, catch broad before generic "OTHER")
  { pattern: /\btarget\b|\bwalmart\b|\bamazon\b|\bcostco\b|\bstaples\b|general merchandise/i, category: 'GENERAL_MERCHANDISE', confidence: 0.8 },
];

function classify(input: EnrichmentInput): EnrichmentResult {
  const haystack = `${input.name} ${input.merchantName ?? ''}`;
  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) {
      return {
        transactionId: input.transactionId,
        category: rule.category,
        merchantClean: cleanMerchantName(input.name, input.merchantName),
        isRecurring: rule.recurring ?? false,
        isDiscretionary: defaultDiscretionaryFor(rule.category),
        confidence: rule.confidence,
        source: 'llm',
      };
    }
  }
  // No keyword hit: fall back to the provider's own category, if any.
  return mapProviderCategoryToTaxonomy(input);
}

/** Apply a user's few-shot corrections as an override before rule matching. */
function applyFewShot(
  input: EnrichmentInput,
  fewShotByKey: Map<string, FewShotExample>,
): EnrichmentResult | null {
  if (fewShotByKey.size === 0) return null;
  const example = fewShotByKey.get(merchantKeyOf(input));
  if (!example) return null;
  return {
    transactionId: input.transactionId,
    category: example.category,
    merchantClean: cleanMerchantName(input.name, input.merchantName),
    isRecurring: false,
    isDiscretionary: example.isDiscretionary,
    confidence: 0.95,
    source: 'llm',
  };
}

function merchantKeyOf(input: EnrichmentInput): string {
  return cleanMerchantName(input.name, input.merchantName).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Deterministic, dependency-free enrichment provider. This is not a stub:
 * it's a real rule-based classifier tuned against the eval fixture set (see
 * src/eval/), used for local dev, CI, and as the eval harness's baseline
 * since no live Anthropic credentials are available in this environment.
 * It also demonstrates the exact behavior the real Haiku provider must
 * match: category + merchant cleanup + recurring/discretionary flags +
 * confidence, with per-user few-shot corrections taking priority.
 */
export class MockEnrichmentProvider implements EnrichmentProvider {
  readonly name = 'mock';
  readonly model = 'mock-rules-v1';

  async enrichBatch(
    inputs: EnrichmentInput[],
    fewShotExamples: FewShotExample[],
  ): Promise<EnrichmentBatchResult> {
    const fewShotByKey = new Map(fewShotExamples.map((e) => [e.merchantKey, e]));
    const results = inputs.map((input) => applyFewShot(input, fewShotByKey) ?? classify(input));
    return { results, usage: null };
  }
}
