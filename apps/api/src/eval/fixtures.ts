// A synthetic, deterministically-generated labeled transaction set for the
// Phase 2 exit gate (PLAN §8: "a hand-labeled 500-transaction set, split
// into a few-shot/dev portion and a held-out portion... the metric that
// matters is discretionary/essential split accuracy"). No live data or
// human labeling pipeline exists in this environment, so this fixture set
// plays that role: every row's expected label was assigned by hand against
// realistic merchant strings, not derived from the classifier being tested.
//
// Most templates are "clean" — a reasonable classifier should get them
// right. A handful are deliberately "hard": the true label (what a human
// bank-statement reviewer would say) diverges from what a naive merchant-
// keyword match would produce, so the eval has real headroom below 100%
// instead of being tautological.

export interface LabeledTransaction {
  transactionId: number;
  name: string;
  merchantName: string | null;
  providerCategory: string | null;
  amountCents: number;
  postedDate: string;
  expectedCategory: string;
  expectedIsDiscretionary: boolean;
}

interface Template {
  name: string;
  merchantName: string | null;
  providerCategory: string | null;
  category: string;
  isDiscretionary: boolean;
  amountMin: number;
  amountMax: number;
  hard?: boolean;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

// "Clean" templates — rule-aligned, one per common real-world merchant shape.
const CLEAN_TEMPLATES: Template[] = [
  { name: 'STARBUCKS #4521', merchantName: 'Starbucks', providerCategory: 'FOOD_AND_DRINK', category: 'COFFEE_SHOPS', isDiscretionary: true, amountMin: 450, amountMax: 650 },
  { name: 'DUNKIN #1123', merchantName: "Dunkin'", providerCategory: 'FOOD_AND_DRINK', category: 'COFFEE_SHOPS', isDiscretionary: true, amountMin: 350, amountMax: 600 },
  { name: "MCDONALD'S F1234", merchantName: "McDonald's", providerCategory: 'FOOD_AND_DRINK', category: 'FAST_FOOD', isDiscretionary: true, amountMin: 650, amountMax: 1200 },
  { name: 'CHIPOTLE 0091', merchantName: 'Chipotle', providerCategory: 'FOOD_AND_DRINK', category: 'FAST_FOOD', isDiscretionary: true, amountMin: 900, amountMax: 1400 },
  { name: 'UBER EATS', merchantName: 'Uber Eats', providerCategory: 'FOOD_AND_DRINK', category: 'RESTAURANTS_AND_DINING', isDiscretionary: true, amountMin: 1500, amountMax: 3500 },
  { name: 'DOORDASH*WENDYS', merchantName: 'DoorDash', providerCategory: 'FOOD_AND_DRINK', category: 'RESTAURANTS_AND_DINING', isDiscretionary: true, amountMin: 1200, amountMax: 2800 },
  { name: 'OLIVE GARDEN 445', merchantName: 'Olive Garden', providerCategory: 'FOOD_AND_DRINK', category: 'RESTAURANTS_AND_DINING', isDiscretionary: true, amountMin: 3000, amountMax: 6500 },
  { name: 'THE CORNER BISTRO', merchantName: null, providerCategory: 'FOOD_AND_DRINK', category: 'RESTAURANTS_AND_DINING', isDiscretionary: true, amountMin: 2500, amountMax: 5500 },
  { name: 'WHOLEFDS MKT 1123', merchantName: 'Whole Foods Market', providerCategory: 'FOOD_AND_DRINK', category: 'GROCERIES', isDiscretionary: false, amountMin: 4000, amountMax: 12000 },
  { name: "TRADER JOE'S #221", merchantName: "Trader Joe's", providerCategory: 'FOOD_AND_DRINK', category: 'GROCERIES', isDiscretionary: false, amountMin: 3000, amountMax: 9000 },
  { name: 'SAFEWAY #0451', merchantName: 'Safeway', providerCategory: 'FOOD_AND_DRINK', category: 'GROCERIES', isDiscretionary: false, amountMin: 5000, amountMax: 11000 },
  { name: 'LOCAL TAPROOM', merchantName: null, providerCategory: 'FOOD_AND_DRINK', category: 'BARS_AND_ALCOHOL', isDiscretionary: true, amountMin: 2000, amountMax: 5000 },
  { name: 'TOTAL WINE & MORE', merchantName: 'Total Wine', providerCategory: 'FOOD_AND_DRINK', category: 'BARS_AND_ALCOHOL', isDiscretionary: true, amountMin: 3000, amountMax: 8000 },
  { name: 'SHELL OIL 57392847', merchantName: 'Shell', providerCategory: 'TRANSPORTATION', category: 'GAS_AND_FUEL', isDiscretionary: false, amountMin: 3500, amountMax: 7000 },
  { name: 'CHEVRON 00293', merchantName: 'Chevron', providerCategory: 'TRANSPORTATION', category: 'GAS_AND_FUEL', isDiscretionary: false, amountMin: 3500, amountMax: 7000 },
  { name: 'UBER *TRIP HELP.UBER.COM', merchantName: 'Uber', providerCategory: 'TRANSPORTATION', category: 'RIDESHARE_AND_TAXI', isDiscretionary: true, amountMin: 800, amountMax: 3500 },
  { name: 'LYFT *RIDE THU 3PM', merchantName: 'Lyft', providerCategory: 'TRANSPORTATION', category: 'RIDESHARE_AND_TAXI', isDiscretionary: true, amountMin: 800, amountMax: 3200 },
  { name: 'MTA*NYCT PAYGO', merchantName: 'MTA', providerCategory: 'TRANSPORTATION', category: 'PUBLIC_TRANSIT', isDiscretionary: false, amountMin: 275, amountMax: 2750 },
  { name: 'JIFFY LUBE #2234', merchantName: 'Jiffy Lube', providerCategory: 'TRANSPORTATION', category: 'AUTO_MAINTENANCE', isDiscretionary: false, amountMin: 4000, amountMax: 9000 },
  { name: 'AUTOZONE #0341', merchantName: 'AutoZone', providerCategory: 'TRANSPORTATION', category: 'AUTO_MAINTENANCE', isDiscretionary: false, amountMin: 1500, amountMax: 6000 },
  { name: 'LAZ PARKING', merchantName: null, providerCategory: 'TRANSPORTATION', category: 'PARKING_AND_TOLLS', isDiscretionary: false, amountMin: 500, amountMax: 2500 },
  { name: 'E-ZPASS NY', merchantName: null, providerCategory: 'TRANSPORTATION', category: 'PARKING_AND_TOLLS', isDiscretionary: false, amountMin: 600, amountMax: 2000 },
  { name: 'NETFLIX.COM', merchantName: 'Netflix', providerCategory: 'ENTERTAINMENT', category: 'SUBSCRIPTIONS_AND_STREAMING', isDiscretionary: true, amountMin: 1599, amountMax: 1599 },
  { name: 'HULU 855-7454858', merchantName: 'Hulu', providerCategory: 'ENTERTAINMENT', category: 'SUBSCRIPTIONS_AND_STREAMING', isDiscretionary: true, amountMin: 1299, amountMax: 1299 },
  { name: 'SPOTIFY USA', merchantName: 'Spotify', providerCategory: 'ENTERTAINMENT', category: 'SUBSCRIPTIONS_AND_STREAMING', isDiscretionary: true, amountMin: 1199, amountMax: 1199 },
  { name: 'DISNEY PLUS', merchantName: 'Disney+', providerCategory: 'ENTERTAINMENT', category: 'SUBSCRIPTIONS_AND_STREAMING', isDiscretionary: true, amountMin: 1399, amountMax: 1399 },
  { name: 'PLANET FITNESS #0192', merchantName: 'Planet Fitness', providerCategory: 'PERSONAL_CARE', category: 'FITNESS_AND_GYM', isDiscretionary: true, amountMin: 1099, amountMax: 2499 },
  { name: 'EQUINOX FITNESS CLUB', merchantName: 'Equinox', providerCategory: 'PERSONAL_CARE', category: 'FITNESS_AND_GYM', isDiscretionary: true, amountMin: 18500, amountMax: 25500 },
  { name: 'PELOTON MEMBERSHIP', merchantName: 'Peloton', providerCategory: 'PERSONAL_CARE', category: 'FITNESS_AND_GYM', isDiscretionary: true, amountMin: 4400, amountMax: 4400 },
  { name: 'GREAT CLIPS #0921', merchantName: 'Great Clips', providerCategory: 'PERSONAL_CARE', category: 'PERSONAL_CARE', isDiscretionary: true, amountMin: 1800, amountMax: 3200 },
  { name: 'LUXE NAIL SALON', merchantName: null, providerCategory: 'PERSONAL_CARE', category: 'PERSONAL_CARE', isDiscretionary: true, amountMin: 3500, amountMax: 6500 },
  { name: "NORDSTROM #0234", merchantName: "Nordstrom", providerCategory: 'GENERAL_MERCHANDISE', category: 'CLOTHING', isDiscretionary: true, amountMin: 6000, amountMax: 18000 },
  { name: 'GAP US 00234', merchantName: 'Gap', providerCategory: 'GENERAL_MERCHANDISE', category: 'CLOTHING', isDiscretionary: true, amountMin: 3500, amountMax: 9500 },
  { name: 'NIKE.COM', merchantName: 'Nike', providerCategory: 'GENERAL_MERCHANDISE', category: 'CLOTHING', isDiscretionary: true, amountMin: 6000, amountMax: 15000 },
  { name: 'BEST BUY #0071', merchantName: 'Best Buy', providerCategory: 'GENERAL_MERCHANDISE', category: 'ELECTRONICS', isDiscretionary: true, amountMin: 5000, amountMax: 45000 },
  { name: 'APPLE STORE R421', merchantName: 'Apple', providerCategory: 'GENERAL_MERCHANDISE', category: 'ELECTRONICS', isDiscretionary: true, amountMin: 10000, amountMax: 120000 },
  { name: 'HOME DEPOT #0451', merchantName: 'Home Depot', providerCategory: 'HOME_IMPROVEMENT', category: 'HOME_IMPROVEMENT', isDiscretionary: false, amountMin: 3000, amountMax: 25000 },
  { name: "LOWE'S #01234", merchantName: "Lowe's", providerCategory: 'HOME_IMPROVEMENT', category: 'HOME_IMPROVEMENT', isDiscretionary: false, amountMin: 3000, amountMax: 22000 },
  { name: 'IKEA HOUSTON', merchantName: 'IKEA', providerCategory: 'GENERAL_MERCHANDISE', category: 'HOME_GOODS', isDiscretionary: true, amountMin: 5000, amountMax: 30000 },
  { name: 'BED BATH & BEYOND', merchantName: 'Bed Bath & Beyond', providerCategory: 'GENERAL_MERCHANDISE', category: 'HOME_GOODS', isDiscretionary: true, amountMin: 3000, amountMax: 9000 },
  { name: 'PG&E WEB PAYMENT', merchantName: 'PG&E', providerCategory: 'RENT_AND_UTILITIES', category: 'UTILITIES', isDiscretionary: false, amountMin: 8000, amountMax: 18000 },
  { name: 'CON ED OF NY', merchantName: 'Con Edison', providerCategory: 'RENT_AND_UTILITIES', category: 'UTILITIES', isDiscretionary: false, amountMin: 6000, amountMax: 15000 },
  { name: 'COMCAST CABLE COMM', merchantName: 'Comcast', providerCategory: 'RENT_AND_UTILITIES', category: 'INTERNET_AND_PHONE', isDiscretionary: false, amountMin: 7500, amountMax: 12000 },
  { name: 'VERIZON WIRELESS', merchantName: 'Verizon', providerCategory: 'RENT_AND_UTILITIES', category: 'INTERNET_AND_PHONE', isDiscretionary: false, amountMin: 8000, amountMax: 15000 },
  { name: 'GEICO *AUTO INS', merchantName: 'GEICO', providerCategory: 'INSURANCE', category: 'INSURANCE', isDiscretionary: false, amountMin: 12000, amountMax: 24000 },
  { name: 'STATE FARM INSURANCE', merchantName: 'State Farm', providerCategory: 'INSURANCE', category: 'INSURANCE', isDiscretionary: false, amountMin: 15000, amountMax: 30000 },
  { name: 'CVS/PHARMACY #0451', merchantName: 'CVS Pharmacy', providerCategory: 'MEDICAL', category: 'PHARMACY', isDiscretionary: false, amountMin: 1200, amountMax: 6000 },
  { name: 'WALGREENS #04521', merchantName: 'Walgreens', providerCategory: 'MEDICAL', category: 'PHARMACY', isDiscretionary: false, amountMin: 1000, amountMax: 5500 },
  { name: 'NORTHSIDE MEDICAL CLINIC', merchantName: null, providerCategory: 'MEDICAL', category: 'HEALTHCARE', isDiscretionary: false, amountMin: 5000, amountMax: 25000 },
  { name: 'BRIGHT SMILES DENTAL', merchantName: null, providerCategory: 'MEDICAL', category: 'HEALTHCARE', isDiscretionary: false, amountMin: 8000, amountMax: 35000 },
  { name: 'SUNNY DAYS DAYCARE', merchantName: null, providerCategory: 'GENERAL_SERVICES', category: 'CHILDCARE', isDiscretionary: false, amountMin: 60000, amountMax: 120000 },
  { name: 'STATE UNIVERSITY TUITION', merchantName: null, providerCategory: 'GENERAL_SERVICES', category: 'EDUCATION', isDiscretionary: false, amountMin: 200000, amountMax: 500000 },
  { name: 'PETCO #0234', merchantName: 'Petco', providerCategory: 'GENERAL_MERCHANDISE', category: 'PET_CARE', isDiscretionary: false, amountMin: 2000, amountMax: 8000 },
  { name: 'WESTSIDE VETERINARY CLINIC', merchantName: null, providerCategory: 'GENERAL_SERVICES', category: 'PET_CARE', isDiscretionary: false, amountMin: 5000, amountMax: 25000 },
  { name: 'RED CROSS DONATION', merchantName: 'American Red Cross', providerCategory: 'GENERAL_SERVICES', category: 'CHARITY', isDiscretionary: true, amountMin: 2500, amountMax: 10000 },
  { name: 'GOFUNDME DONATION', merchantName: 'GoFundMe', providerCategory: 'GENERAL_SERVICES', category: 'CHARITY', isDiscretionary: true, amountMin: 2000, amountMax: 15000 },
  { name: 'OVERDRAFT FEE', merchantName: null, providerCategory: 'BANK_FEES', category: 'FEES_AND_CHARGES', isDiscretionary: false, amountMin: 3500, amountMax: 3500 },
  { name: 'ATM WITHDRAWAL FEE', merchantName: null, providerCategory: 'BANK_FEES', category: 'FEES_AND_CHARGES', isDiscretionary: false, amountMin: 250, amountMax: 500 },
  { name: 'NORTHVIEW APARTMENTS LLC', merchantName: null, providerCategory: 'RENT_AND_UTILITIES', category: 'RENT_OR_MORTGAGE', isDiscretionary: false, amountMin: 145000, amountMax: 225000 },
  { name: 'WELLS FARGO HOME MTG', merchantName: 'Wells Fargo', providerCategory: 'RENT_AND_UTILITIES', category: 'RENT_OR_MORTGAGE', isDiscretionary: false, amountMin: 180000, amountMax: 260000 },
  { name: 'DELTA AIR LINES', merchantName: 'Delta', providerCategory: 'TRAVEL', category: 'TRAVEL_AND_LODGING', isDiscretionary: true, amountMin: 25000, amountMax: 65000 },
  { name: 'MARRIOTT HOTELS', merchantName: 'Marriott', providerCategory: 'TRAVEL', category: 'TRAVEL_AND_LODGING', isDiscretionary: true, amountMin: 15000, amountMax: 45000 },
  { name: 'AIRBNB * HMXY2Z', merchantName: 'Airbnb', providerCategory: 'TRAVEL', category: 'TRAVEL_AND_LODGING', isDiscretionary: true, amountMin: 20000, amountMax: 55000 },
  { name: 'IRS USATAXPYMT', merchantName: 'IRS', providerCategory: 'GOVERNMENT_AND_NON_PROFIT', category: 'TAXES', isDiscretionary: false, amountMin: 50000, amountMax: 350000 },
  { name: 'SALLIE MAE LOAN PMT', merchantName: 'Sallie Mae', providerCategory: 'LOAN_PAYMENTS', category: 'LOAN_PAYMENT', isDiscretionary: false, amountMin: 20000, amountMax: 45000 },
  { name: 'DISCOVER CARD PAYMENT', merchantName: 'Discover', providerCategory: 'LOAN_PAYMENTS', category: 'CREDIT_CARD_PAYMENT', isDiscretionary: false, amountMin: 30000, amountMax: 90000 },
  { name: 'VANGUARD BUY', merchantName: 'Vanguard', providerCategory: 'TRANSFER_OUT', category: 'SAVINGS_AND_INVESTMENT', isDiscretionary: false, amountMin: 50000, amountMax: 200000 },
  { name: 'ACME CORP PAYROLL', merchantName: null, providerCategory: 'INCOME', category: 'INCOME', isDiscretionary: false, amountMin: 250000, amountMax: 450000 },
  { name: 'ONLINE TRANSFER TO SAV', merchantName: null, providerCategory: 'TRANSFER_OUT', category: 'TRANSFER', isDiscretionary: false, amountMin: 20000, amountMax: 100000 },
  { name: 'AUTO LOAN PAYMENT TOYOTA', merchantName: 'Toyota Financial', providerCategory: 'LOAN_PAYMENTS', category: 'AUTO_PAYMENT', isDiscretionary: false, amountMin: 35000, amountMax: 55000 },
  { name: 'FIVE GUYS #0231', merchantName: 'Five Guys', providerCategory: 'FOOD_AND_DRINK', category: 'FAST_FOOD', isDiscretionary: true, amountMin: 1200, amountMax: 2200 },
  { name: 'IN-N-OUT BURGER', merchantName: 'In-N-Out', providerCategory: 'FOOD_AND_DRINK', category: 'FAST_FOOD', isDiscretionary: true, amountMin: 900, amountMax: 1800 },
  { name: 'PANERA BREAD #0021', merchantName: 'Panera', providerCategory: 'FOOD_AND_DRINK', category: 'FAST_FOOD', isDiscretionary: true, amountMin: 1000, amountMax: 1900 },
  { name: 'ALDI 34521', merchantName: 'Aldi', providerCategory: 'FOOD_AND_DRINK', category: 'GROCERIES', isDiscretionary: false, amountMin: 2500, amountMax: 8000 },
  { name: 'PUBLIX #0442', merchantName: 'Publix', providerCategory: 'FOOD_AND_DRINK', category: 'GROCERIES', isDiscretionary: false, amountMin: 3500, amountMax: 10000 },
  { name: 'CROSSFIT DOWNTOWN', merchantName: null, providerCategory: 'PERSONAL_CARE', category: 'FITNESS_AND_GYM', isDiscretionary: true, amountMin: 15000, amountMax: 20000 },
];

// "Hard" templates — the true label diverges from what a naive keyword
// match on the merchant string would produce, so the eval measures real
// discretionary-vs-essential judgment rather than string matching.
const HARD_TEMPLATES: Template[] = [
  { name: 'COSTCO WHSE #0234', merchantName: 'Costco', providerCategory: 'GENERAL_MERCHANDISE', category: 'GROCERIES', isDiscretionary: false, amountMin: 8000, amountMax: 22000, hard: true },
  { name: 'AMAZON.COM*M12AB3CD', merchantName: 'Amazon', providerCategory: 'GENERAL_MERCHANDISE', category: 'HOME_GOODS', isDiscretionary: false, amountMin: 1500, amountMax: 6000, hard: true },
  { name: 'WALMART.COM 8452', merchantName: 'Walmart', providerCategory: 'GENERAL_MERCHANDISE', category: 'GROCERIES', isDiscretionary: false, amountMin: 3000, amountMax: 9000, hard: true },
  { name: 'UBER *TRIP 8:15AM COMMUTE', merchantName: 'Uber', providerCategory: 'TRANSPORTATION', category: 'RIDESHARE_AND_TAXI', isDiscretionary: false, amountMin: 1200, amountMax: 2200, hard: true },
  { name: 'TARGET 00234', merchantName: 'Target', providerCategory: 'GENERAL_MERCHANDISE', category: 'PHARMACY', isDiscretionary: false, amountMin: 800, amountMax: 3000, hard: true },
  { name: 'STAPLES #0234', merchantName: 'Staples', providerCategory: 'GENERAL_MERCHANDISE', category: 'BUSINESS_EXPENSE', isDiscretionary: false, amountMin: 2000, amountMax: 9000, hard: true },
];

const TEMPLATES: Template[] = [...CLEAN_TEMPLATES, ...HARD_TEMPLATES];

const TOTAL = 500;

function buildFixtures(): LabeledTransaction[] {
  const fixtures: LabeledTransaction[] = [];
  for (let i = 0; i < TOTAL; i++) {
    const template = TEMPLATES[i % TEMPLATES.length]!;
    const range = template.amountMax - template.amountMin;
    const amount = template.amountMin + (range === 0 ? 0 : (i * 137) % (range + 1));
    fixtures.push({
      transactionId: i + 1,
      name: template.name,
      merchantName: template.merchantName,
      providerCategory: template.providerCategory,
      amountCents: template.category === 'INCOME' ? -amount : amount,
      postedDate: daysAgo(1 + (i % 400)),
      expectedCategory: template.category,
      expectedIsDiscretionary: template.isDiscretionary,
    });
  }
  return fixtures;
}

export const EVAL_FIXTURES: LabeledTransaction[] = buildFixtures();

// First 100 are the few-shot/dev portion (safe to hand-tune rules against);
// the remaining 400 are held out — the accuracy gate only ever reads these.
export const FEW_SHOT_FIXTURES: LabeledTransaction[] = EVAL_FIXTURES.slice(0, 100);
export const HELD_OUT_FIXTURES: LabeledTransaction[] = EVAL_FIXTURES.slice(100);
