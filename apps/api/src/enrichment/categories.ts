// The coaching category taxonomy — ~40 categories tuned for "should I spend
// less here" coaching, not double-entry accounting. Every category carries a
// default discretionary/essential lean; the enrichment provider can override
// it per-transaction (e.g. a $400 "Restaurants" catering order for a business
// deduction), but the default is what fallback/degraded paths use.

export interface CategoryDef {
  readonly id: string;
  readonly label: string;
  readonly defaultDiscretionary: boolean;
}

export const CATEGORY_TAXONOMY: readonly CategoryDef[] = [
  { id: 'GROCERIES', label: 'Groceries', defaultDiscretionary: false },
  { id: 'RESTAURANTS_AND_DINING', label: 'Restaurants & Dining', defaultDiscretionary: true },
  { id: 'COFFEE_SHOPS', label: 'Coffee Shops', defaultDiscretionary: true },
  { id: 'BARS_AND_ALCOHOL', label: 'Bars & Alcohol', defaultDiscretionary: true },
  { id: 'FAST_FOOD', label: 'Fast Food', defaultDiscretionary: true },
  { id: 'RENT_OR_MORTGAGE', label: 'Rent or Mortgage', defaultDiscretionary: false },
  { id: 'UTILITIES', label: 'Utilities', defaultDiscretionary: false },
  { id: 'INTERNET_AND_PHONE', label: 'Internet & Phone', defaultDiscretionary: false },
  { id: 'INSURANCE', label: 'Insurance', defaultDiscretionary: false },
  { id: 'HEALTHCARE', label: 'Healthcare & Medical', defaultDiscretionary: false },
  { id: 'PHARMACY', label: 'Pharmacy', defaultDiscretionary: false },
  { id: 'FITNESS_AND_GYM', label: 'Fitness & Gym', defaultDiscretionary: true },
  { id: 'PERSONAL_CARE', label: 'Personal Care', defaultDiscretionary: true },
  { id: 'CLOTHING', label: 'Clothing & Accessories', defaultDiscretionary: true },
  { id: 'ELECTRONICS', label: 'Electronics', defaultDiscretionary: true },
  { id: 'HOME_GOODS', label: 'Home Goods', defaultDiscretionary: true },
  { id: 'HOME_IMPROVEMENT', label: 'Home Improvement', defaultDiscretionary: false },
  { id: 'GENERAL_MERCHANDISE', label: 'General Merchandise', defaultDiscretionary: true },
  { id: 'SUBSCRIPTIONS_AND_STREAMING', label: 'Subscriptions & Streaming', defaultDiscretionary: true },
  { id: 'ENTERTAINMENT', label: 'Entertainment', defaultDiscretionary: true },
  { id: 'HOBBIES', label: 'Hobbies', defaultDiscretionary: true },
  { id: 'TRAVEL_AND_LODGING', label: 'Travel & Lodging', defaultDiscretionary: true },
  { id: 'RIDESHARE_AND_TAXI', label: 'Rideshare & Taxi', defaultDiscretionary: true },
  { id: 'PUBLIC_TRANSIT', label: 'Public Transit', defaultDiscretionary: false },
  { id: 'GAS_AND_FUEL', label: 'Gas & Fuel', defaultDiscretionary: false },
  { id: 'AUTO_PAYMENT', label: 'Auto Loan/Lease Payment', defaultDiscretionary: false },
  { id: 'AUTO_MAINTENANCE', label: 'Auto Maintenance', defaultDiscretionary: false },
  { id: 'PARKING_AND_TOLLS', label: 'Parking & Tolls', defaultDiscretionary: false },
  { id: 'CHILDCARE', label: 'Childcare', defaultDiscretionary: false },
  { id: 'EDUCATION', label: 'Education & Tuition', defaultDiscretionary: false },
  { id: 'PET_CARE', label: 'Pet Care', defaultDiscretionary: false },
  { id: 'GIFTS_AND_DONATIONS', label: 'Gifts & Donations', defaultDiscretionary: true },
  { id: 'CHARITY', label: 'Charity', defaultDiscretionary: true },
  { id: 'FEES_AND_CHARGES', label: 'Fees & Bank Charges', defaultDiscretionary: false },
  { id: 'TAXES', label: 'Taxes', defaultDiscretionary: false },
  { id: 'LOAN_PAYMENT', label: 'Loan Payment', defaultDiscretionary: false },
  { id: 'CREDIT_CARD_PAYMENT', label: 'Credit Card Payment', defaultDiscretionary: false },
  { id: 'SAVINGS_AND_INVESTMENT', label: 'Savings & Investment Transfer', defaultDiscretionary: false },
  { id: 'INCOME', label: 'Income', defaultDiscretionary: false },
  { id: 'TRANSFER', label: 'Account Transfer', defaultDiscretionary: false },
  { id: 'BUSINESS_EXPENSE', label: 'Business Expense', defaultDiscretionary: false },
  { id: 'OTHER', label: 'Other / Uncategorized', defaultDiscretionary: false },
] as const;

export const CATEGORY_IDS = CATEGORY_TAXONOMY.map((c) => c.id) as [string, ...string[]];

const BY_ID = new Map(CATEGORY_TAXONOMY.map((c) => [c.id, c]));

export function isValidCategory(id: string): boolean {
  return BY_ID.has(id);
}

export function defaultDiscretionaryFor(categoryId: string): boolean {
  return BY_ID.get(categoryId)?.defaultDiscretionary ?? false;
}

/** Human-readable label for a category id, for briefs and UI. */
export function labelFor(categoryId: string): string {
  return BY_ID.get(categoryId)?.label ?? 'Other';
}

/** Categories that never count as spend in the feature store (movement, not spend). */
export const NON_SPEND_CATEGORIES = new Set(['INCOME', 'TRANSFER', 'CREDIT_CARD_PAYMENT']);
