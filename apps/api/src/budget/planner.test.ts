import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  allocateProportionally,
  BUDGET_NARRATION_DEADLINE_MS,
  isBudgetBillCategory,
  withBudgetNarrationDeadline,
} from './planner.js';

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

describe('budget narration deadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a fast narration without waiting for the deadline', async () => {
    await expect(withBudgetNarrationDeadline(Promise.resolve('ready'), 25)).resolves.toBe('ready');
  });

  it('rejects a stalled narration so the planner can use its deterministic fallback', async () => {
    vi.useFakeTimers();
    const result = withBudgetNarrationDeadline(new Promise<string>(() => {}), 25);
    const expectation = expect(result).rejects.toThrow('budget narration deadline exceeded');
    await vi.advanceTimersByTimeAsync(25);
    await expectation;
  });

  it('keeps the production deadline below the mobile request timeout', () => {
    expect(BUDGET_NARRATION_DEADLINE_MS).toBeLessThan(20_000);
  });
});
