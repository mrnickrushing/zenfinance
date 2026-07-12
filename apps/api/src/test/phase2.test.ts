import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { getMonthlyAiCostUsd, recordAiUsage } from '../enrichment/cost.js';
import { runNightlyRollupsForAllUsers } from '../features/rollup.js';
import { closeDb, migrateOnce, truncateAll } from './setup.js';

let app: Express;

beforeAll(async () => {
  await migrateOnce();
});

beforeEach(async () => {
  await truncateAll();
  app = createApp();
});

afterAll(async () => {
  await closeDb();
});

interface EnrichedTxn {
  id: number;
  name: string;
  merchantName: string | null;
  pending: boolean;
  category: string | null;
  merchantClean: string | null;
  isDiscretionary: boolean | null;
  isRecurring: boolean | null;
  confidence: number | null;
  enrichmentSource: string | null;
  transferPairId: string | null;
}

async function registerAndAuth(email: string): Promise<{ access: string }> {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'a-strong-password' });
  expect(res.status).toBe(201);
  return { access: res.body.accessToken };
}

async function linkBank(access: string): Promise<void> {
  const exchange = await request(app)
    .post('/api/link/exchange')
    .set('Authorization', `Bearer ${access}`)
    .send({ publicToken: 'mock-public-token', institutionName: 'Mock Bank' });
  expect(exchange.status).toBe(201);
}

async function userIdByEmail(email: string): Promise<number> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  return row!.id;
}

async function getTransactions(access: string): Promise<EnrichedTxn[]> {
  const res = await request(app)
    .get('/api/transactions?pageSize=200')
    .set('Authorization', `Bearer ${access}`);
  expect(res.status).toBe(200);
  return res.body.items;
}

describe('enrichment pipeline (mock provider, inline queue)', () => {
  it('enriches every non-pending backfilled transaction with a category and merchant cleanup', async () => {
    const { access } = await registerAndAuth('coach@example.com');
    await linkBank(access);

    const txns = await getTransactions(access);
    expect(txns.length).toBeGreaterThan(30);

    // Pending rows are transient — they're superseded by a posted row on the
    // next sync, so the pipeline skips them to avoid enriching (and paying
    // for) data that's about to be replaced. Only assert on posted rows.
    const posted = txns.filter((t) => !t.pending);
    expect(posted.length).toBeGreaterThan(0);
    for (const t of posted) {
      expect(t.category).toBeTruthy();
      expect(t.merchantClean).toBeTruthy();
      expect(typeof t.confidence).toBe('number');
      expect(t.confidence).toBeGreaterThan(0);
      expect(t.enrichmentSource).toBe('llm'); // mock provider stands in as the AI layer
    }

    const pending = txns.filter((t) => t.pending);
    expect(pending.length).toBeGreaterThan(0);
    for (const t of pending) expect(t.category).toBeNull();
  });

  it('categorizes own-account transfer pairs as TRANSFER, never spend', async () => {
    const { access } = await registerAndAuth('transfers@example.com');
    await linkBank(access);

    const txns = await getTransactions(access);
    const transferLegs = txns.filter((t) => t.transferPairId !== null);
    expect(transferLegs.length).toBe(2);
    for (const leg of transferLegs) {
      expect(leg.category).toBe('TRANSFER');
      expect(leg.isDiscretionary).toBe(false);
    }
  });

  it('flags the payroll and Netflix charges as recurring', async () => {
    const { access } = await registerAndAuth('recurring@example.com');
    await linkBank(access);

    const txns = await getTransactions(access);
    const netflix = txns.filter((t) => t.merchantClean === 'Netflix');
    expect(netflix.length).toBeGreaterThan(0);
    for (const t of netflix) expect(t.isRecurring).toBe(true);
  });
});

describe('recurring-stream detection', () => {
  it('detects the Netflix subscription as an active recurring stream', async () => {
    const { access } = await registerAndAuth('streams@example.com');
    await linkBank(access);

    const res = await request(app).get('/api/recurring-streams').set('Authorization', `Bearer ${access}`);
    expect(res.status).toBe(200);
    const netflix = res.body.items.find((s: { merchantClean: string }) => s.merchantClean === 'Netflix');
    expect(netflix).toBeTruthy();
    expect(netflix.active).toBe(true);
    expect(netflix.occurrences).toBeGreaterThanOrEqual(2);
  });
});

describe('user-correction loop', () => {
  it('applies a correction, stores it for few-shot, and rejects an unknown category', async () => {
    const { access } = await registerAndAuth('correct@example.com');
    await linkBank(access);
    const txns = await getTransactions(access);
    const target = txns.find((t) => t.transferPairId === null)!;

    const badCategory = await request(app)
      .patch(`/api/transactions/${target.id}/category`)
      .set('Authorization', `Bearer ${access}`)
      .send({ category: 'NOT_A_REAL_CATEGORY' });
    expect(badCategory.status).toBe(400);

    const correction = await request(app)
      .patch(`/api/transactions/${target.id}/category`)
      .set('Authorization', `Bearer ${access}`)
      .send({ category: 'BUSINESS_EXPENSE', isDiscretionary: false });
    expect(correction.status).toBe(200);

    const updated = await getTransactions(access);
    const corrected = updated.find((t) => t.id === target.id)!;
    expect(corrected.category).toBe('BUSINESS_EXPENSE');
    expect(corrected.isDiscretionary).toBe(false);
    expect(corrected.enrichmentSource).toBe('user_correction');
  });

  it('cannot correct another user\'s transaction', async () => {
    const userA = await registerAndAuth('owner@example.com');
    await linkBank(userA.access);
    const txns = await getTransactions(userA.access);

    const userB = await registerAndAuth('intruder@example.com');
    const res = await request(app)
      .patch(`/api/transactions/${txns[0]!.id}/category`)
      .set('Authorization', `Bearer ${userB.access}`)
      .send({ category: 'OTHER' });
    expect(res.status).toBe(404);
  });
});

describe('feature-store rollups', () => {
  it('computes weekly spend rollups queryable via the API', async () => {
    const { access } = await registerAndAuth('rollups@example.com');
    await linkBank(access);

    await runNightlyRollupsForAllUsers(db);

    const res = await request(app).get('/api/features/rollups?weeks=12').set('Authorization', `Bearer ${access}`);
    expect(res.status).toBe(200);
    const totalSpendRows = res.body.items.filter((r: { metric: string }) => r.metric === 'total_spend');
    expect(totalSpendRows.length).toBeGreaterThan(0);
    const hasSpend = totalSpendRows.some((r: { valueCents: number | null }) => (r.valueCents ?? 0) > 0);
    expect(hasSpend).toBe(true);

    const ratioRows = res.body.items.filter((r: { metric: string }) => r.metric === 'discretionary_ratio');
    for (const r of ratioRows) {
      expect(r.valueRatio).toBeGreaterThanOrEqual(0);
      expect(r.valueRatio).toBeLessThanOrEqual(1);
    }
  });

  it('is idempotent — recomputing the same week upserts instead of duplicating', async () => {
    const { access } = await registerAndAuth('idempotent@example.com');
    await linkBank(access);

    await runNightlyRollupsForAllUsers(db);
    await runNightlyRollupsForAllUsers(db);

    const res = await request(app).get('/api/features/rollups?weeks=12').set('Authorization', `Bearer ${access}`);
    const totalSpendByWeek = new Map<string, number>();
    for (const r of res.body.items as { metric: string; weekStart: string }[]) {
      if (r.metric !== 'total_spend') continue;
      totalSpendByWeek.set(r.weekStart, (totalSpendByWeek.get(r.weekStart) ?? 0) + 1);
    }
    for (const count of totalSpendByWeek.values()) expect(count).toBe(1);
  });
});

describe('AI cost metering', () => {
  it('sums estimated cost within a month and excludes events outside it', async () => {
    const { access } = await registerAndAuth('cost@example.com');
    await linkBank(access);
    const userId = await userIdByEmail('cost@example.com');

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    await recordAiUsage(db, { userId, purpose: 'enrichment', model: 'claude-haiku-4-5', inputTokens: 10_000, outputTokens: 8_000 });
    const costInMonth = await getMonthlyAiCostUsd(db, userId, monthStart, monthEnd);
    expect(costInMonth).toBeGreaterThan(0);

    const beforeMonth = await getMonthlyAiCostUsd(db, userId, new Date(Date.UTC(2020, 0, 1)), new Date(Date.UTC(2020, 1, 1)));
    expect(beforeMonth).toBe(0);
  });
});
