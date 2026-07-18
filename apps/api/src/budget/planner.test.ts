import { describe, expect, it } from 'vitest';
import { allocateProportionally, isBudgetBillCategory } from './planner.js';

describe('budget planner safeguards', () => {
  it('keeps every proportional allocation within its category baseline', () => {
    const allocation = allocateProportionally([
      { category: 'ONE', baselineCents: 1 },
      { category: 'TWO', baselineCents: 1 },
      { category: 'THREE', baselineCents: 1 },
    ], 2);

    expect([...allocation.values()].reduce((sum, amount) => sum + amount, 0)).toBe(2);
    expect([...allocation.values()].every((amount) => amount <= 1)).toBe(true);
  });

  it('excludes account movements from recurring budget bills', () => {
    expect(isBudgetBillCategory('CREDIT_CARD_PAYMENT')).toBe(false);
    expect(isBudgetBillCategory('TRANSFER')).toBe(false);
    expect(isBudgetBillCategory('RENT_AND_MORTGAGE')).toBe(true);
    expect(isBudgetBillCategory(null)).toBe(true);
  });
});
