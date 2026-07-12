import { defaultDiscretionaryFor, isValidCategory } from './categories.js';
import { cleanMerchantName } from './textNormalize.js';
import type { EnrichmentInput, EnrichmentResult } from './types.js';

// Plaid's own personal-finance-category primary values, mapped onto our
// coaching taxonomy. This is the deterministic path used when the LLM call
// fails or is unavailable — per PLAN §4 ("Low-confidence items fall back to
// Plaid's own enrichment") — so enrichment coverage never depends on the AI
// layer being up.
const PLAID_PRIMARY_MAP: Record<string, string> = {
  INCOME: 'INCOME',
  TRANSFER_IN: 'TRANSFER',
  TRANSFER_OUT: 'TRANSFER',
  LOAN_PAYMENTS: 'LOAN_PAYMENT',
  BANK_FEES: 'FEES_AND_CHARGES',
  ENTERTAINMENT: 'ENTERTAINMENT',
  FOOD_AND_DRINK: 'RESTAURANTS_AND_DINING',
  GENERAL_MERCHANDISE: 'GENERAL_MERCHANDISE',
  HOME_IMPROVEMENT: 'HOME_IMPROVEMENT',
  MEDICAL: 'HEALTHCARE',
  PERSONAL_CARE: 'PERSONAL_CARE',
  GENERAL_SERVICES: 'OTHER',
  GOVERNMENT_AND_NON_PROFIT: 'TAXES',
  TRANSPORTATION: 'GAS_AND_FUEL',
  TRAVEL: 'TRAVEL_AND_LODGING',
  RENT_AND_UTILITIES: 'UTILITIES',
};

/** Deterministic fallback categorization from the provider's own category string. */
export function mapProviderCategoryToTaxonomy(input: EnrichmentInput): EnrichmentResult {
  const primary = (input.providerCategory ?? '').split('.')[0]?.toUpperCase() ?? '';
  const category = PLAID_PRIMARY_MAP[primary] ?? 'OTHER';
  const resolved = isValidCategory(category) ? category : 'OTHER';
  return {
    transactionId: input.transactionId,
    category: resolved,
    merchantClean: cleanMerchantName(input.name, input.merchantName),
    isRecurring: false,
    isDiscretionary: defaultDiscretionaryFor(resolved),
    confidence: 0.3,
    source: 'fallback',
  };
}
