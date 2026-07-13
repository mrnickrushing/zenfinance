import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { computeZenScore } from '../coaching/zenScore.js';
import { db } from '../db/client.js';
import { featureRollups, goals, users } from '../db/schema.js';
import { closeDb, migrateOnce, truncateAll } from './setup.js';

beforeAll(async () => {
  await migrateOnce();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeDb();
});

async function makeUser(email: string): Promise<number> {
  const [row] = await db.insert(users).values({ email }).returning({ id: users.id });
  return row!.id;
}

const WEEKS = ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06'];

async function seedWeek(
  userId: number,
  week: string,
  fig: { incomeCents?: number; spendCents?: number; discretionaryRatio?: number },
) {
  const rows: (typeof featureRollups.$inferInsert)[] = [];
  if (fig.incomeCents !== undefined) {
    rows.push({ aggregateId: `${userId}:${week}:income_total`, userId, weekStart: week, metric: 'income_total', valueCents: fig.incomeCents });
  }
  if (fig.spendCents !== undefined) {
    rows.push({ aggregateId: `${userId}:${week}:total_spend`, userId, weekStart: week, metric: 'total_spend', valueCents: fig.spendCents });
  }
  if (fig.discretionaryRatio !== undefined) {
    rows.push({ aggregateId: `${userId}:${week}:discretionary_ratio`, userId, weekStart: week, metric: 'discretionary_ratio', valueRatio: fig.discretionaryRatio });
  }
  if (rows.length) await db.insert(featureRollups).values(rows);
}

function component(view: Awaited<ReturnType<typeof computeZenScore>>, key: string) {
  return view.components.find((c) => c.key === key)!;
}

describe('computeZenScore', () => {
  it('returns a null score and onboarding caption when there is no data', async () => {
    const userId = await makeUser('empty@example.com');
    const view = await computeZenScore(db, userId);
    expect(view.score).toBeNull();
    expect(view.components).toHaveLength(3);
    expect(view.components.every((c) => c.value === null)).toBe(true);
    expect(view.caption).toMatch(/link an account/i);
  });

  it('scores a healthy profile high across all three components', async () => {
    const userId = await makeUser('healthy@example.com');
    // 6 weeks: $5,000 income, $3,000 spend (40% savings rate), low discretionary.
    for (const week of WEEKS) {
      await seedWeek(userId, week, { incomeCents: 500000, spendCents: 300000, discretionaryRatio: 0.2 });
    }
    await db.insert(goals).values({
      userId,
      name: 'Emergency fund',
      targetAmountCents: 1000000,
      currentAmountCents: 800000,
      targetDate: '2027-06-01',
    });

    const view = await computeZenScore(db, userId);
    expect(view.score).not.toBeNull();
    expect(view.score!).toBeGreaterThanOrEqual(75);

    expect(component(view, 'mindful_spending').value!).toBeGreaterThan(70); // ratio 0.2 → ~89
    expect(component(view, 'growth_savings').value!).toBeGreaterThan(60);
    expect(component(view, 'consistency').value).toBe(100); // every week net-positive & discretionary ≤ 0.5
    expect(view.caption).toMatch(/blooming|steady/i);
  });

  it('scores a strained profile low and floors components at 20', async () => {
    const userId = await makeUser('strained@example.com');
    // Overspending every week, high discretionary ratio.
    for (const week of WEEKS) {
      await seedWeek(userId, week, { incomeCents: 300000, spendCents: 360000, discretionaryRatio: 0.55 });
    }

    const view = await computeZenScore(db, userId);
    expect(view.score).not.toBeNull();
    expect(view.score!).toBeLessThan(45);
    expect(component(view, 'consistency').value).toBe(20); // 0 on-track weeks → floored
    expect(component(view, 'mindful_spending').value!).toBeLessThan(45);
    // Every present component respects the floor.
    for (const c of view.components) {
      if (c.value !== null) expect(c.value).toBeGreaterThanOrEqual(20);
    }
  });

  it('counts spend between paychecks against the savings rate (biweekly income)', async () => {
    const userId = await makeUser('biweekly@example.com');
    // One payday week, then three spend-only weeks with no income.
    await seedWeek(userId, WEEKS[0], { incomeCents: 500000, spendCents: 50000 });
    await seedWeek(userId, WEEKS[1], { spendCents: 200000 });
    await seedWeek(userId, WEEKS[2], { spendCents: 200000 });
    await seedWeek(userId, WEEKS[3], { spendCents: 200000 });
    const view = await computeZenScore(db, userId);
    // net = 5000 − 500 − (2000 × 3) = −1500 on 5000 income → negative rate → floored.
    expect(component(view, 'growth_savings').value).toBe(20);
  });

  it('ignores zero-activity rollup weeks so an idle account stays in onboarding', async () => {
    const userId = await makeUser('idle@example.com');
    // The rollup job emits zeroed _total rows for weeks with no transactions.
    for (const week of WEEKS) {
      await seedWeek(userId, week, { incomeCents: 0, spendCents: 0, discretionaryRatio: 0 });
    }
    const view = await computeZenScore(db, userId);
    expect(view.score).toBeNull();
    expect(view.components.every((c) => c.value === null)).toBe(true);
  });

  it('omits components without data from the weighted average', async () => {
    const userId = await makeUser('partial@example.com');
    // Only spend + discretionary ratio for two weeks — no income, no goals.
    for (const week of WEEKS.slice(0, 2)) {
      await seedWeek(userId, week, { spendCents: 200000, discretionaryRatio: 0.25 });
    }
    const view = await computeZenScore(db, userId);
    expect(component(view, 'mindful_spending').value).not.toBeNull();
    expect(component(view, 'growth_savings').value).toBeNull(); // no income, no goals
    expect(component(view, 'consistency').value).not.toBeNull();
    expect(view.score).not.toBeNull();
  });
});
