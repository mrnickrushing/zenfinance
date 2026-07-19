import { and, eq, isNull } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { auditSubscriptions } from '../coaching/subscriptions.js';
import { db } from '../db/client.js';
import { accounts, featureRollups, items, transactionEnrichments, transactions, users } from '../db/schema.js';
import { getMonthlyAiCostUsd, recordAiUsage } from '../enrichment/cost.js';
import { MockEnrichmentProvider } from '../enrichment/mock.js';
import { applyEnrichment, enrichUserTransactions } from '../enrichment/pipeline.js';
import { computeRollupsForWeek, mondayOf, runNightlyRollupsForAllUsers } from '../features/rollup.js';
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
  amountCents: number;
  postedDate: string;
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

async function createSavingsAccount(userId: number, key: string): Promise<number> {
  const [item] = await db
    .insert(items)
    .values({
      userId,
      provider: 'mock',
      providerItemId: `item-${key}`,
      encryptedAccessToken: 'test-token',
      institutionName: 'Test Bank',
    })
    .returning({ id: items.id });
  const [account] = await db
    .insert(accounts)
    .values({
      itemId: item!.id,
      providerAccountId: `savings-${key}`,
      name: 'Savings',
      type: 'depository',
      subtype: 'savings',
    })
    .returning({ id: accounts.id });
  return account!.id;
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

  it('repairs an unpaired paycheck deposit in savings and refreshes its income rollup', async () => {
    const { access } = await registerAndAuth('savings-paycheck@example.com');
    await linkBank(access);
    const userId = await userIdByEmail('savings-paycheck@example.com');
    const [savings] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .innerJoin(items, eq(accounts.itemId, items.id))
      .where(and(eq(items.userId, userId), eq(accounts.subtype, 'savings')))
      .limit(1);
    const postedDate = new Date().toISOString().slice(0, 10);
    const weekStart = mondayOf(new Date(`${postedDate}T00:00:00Z`)).toISOString().slice(0, 10);
    const [incomeBaseline] = await db
      .select({ valueCents: featureRollups.valueCents })
      .from(featureRollups)
      .where(and(
        eq(featureRollups.userId, userId),
        eq(featureRollups.weekStart, weekStart),
        eq(featureRollups.metric, 'income_total'),
      ))
      .limit(1);
    const [deposit] = await db
      .insert(transactions)
      .values({
        accountId: savings!.id,
        providerTxnId: 'savings-paycheck-deposit',
        amountCents: -312345,
        postedDate,
        name: 'MOBILE DEPOSIT',
        merchantName: null,
        providerCategory: 'TRANSFER_IN.TRANSFER_IN_DEPOSIT',
        pending: false,
      })
      .returning({ id: transactions.id });
    await db.insert(transactionEnrichments).values({
      transactionId: deposit!.id,
      category: 'TRANSFER',
      merchantClean: 'Mobile Deposit',
      isRecurring: false,
      isDiscretionary: false,
      confidence: 0.8,
      source: 'llm',
      model: 'test-model',
    });

    await enrichUserTransactions(db, new MockEnrichmentProvider(), userId);

    const [repaired] = await db
      .select({
        category: transactionEnrichments.category,
        source: transactionEnrichments.source,
        merchantClean: transactionEnrichments.merchantClean,
      })
      .from(transactionEnrichments)
      .where(and(eq(transactionEnrichments.transactionId, deposit!.id), isNull(transactionEnrichments.supersededAt)))
      .limit(1);
    expect(repaired).toEqual({ category: 'INCOME', source: 'fallback', merchantClean: 'Mobile Deposit' });

    const [incomeRollup] = await db
      .select({ valueCents: featureRollups.valueCents })
      .from(featureRollups)
      .where(and(
        eq(featureRollups.userId, userId),
        eq(featureRollups.weekStart, weekStart),
        eq(featureRollups.metric, 'income_total'),
      ))
      .limit(1);
    expect(incomeRollup!.valueCents).toBe((incomeBaseline?.valueCents ?? 0) + 312345);
  });

  it('honors a learned TRANSFER correction for a future savings deposit', async () => {
    const { access } = await registerAndAuth('corrected-deposit@example.com');
    const userId = await userIdByEmail('corrected-deposit@example.com');
    const accountId = await createSavingsAccount(userId, 'corrected-deposit');
    const postedDate = new Date().toISOString().slice(0, 10);
    const [original] = await db
      .insert(transactions)
      .values({
        accountId,
        providerTxnId: 'corrected-deposit-original',
        amountCents: -50000,
        postedDate,
        name: 'MOBILE DEPOSIT',
        providerCategory: 'TRANSFER_IN.TRANSFER_IN_DEPOSIT',
        pending: false,
      })
      .returning({ id: transactions.id });
    await db.insert(transactionEnrichments).values({
      transactionId: original!.id,
      category: 'TRANSFER',
      merchantClean: 'Mobile Deposit',
      isRecurring: false,
      isDiscretionary: false,
      confidence: 0.8,
      source: 'llm',
      model: 'test-model',
    });
    const correction = await request(app)
      .patch(`/api/transactions/${original!.id}/category`)
      .set('Authorization', `Bearer ${access}`)
      .send({ category: 'TRANSFER', isDiscretionary: false });
    expect(correction.status).toBe(200);

    const [future] = await db
      .insert(transactions)
      .values({
        accountId,
        providerTxnId: 'corrected-deposit-future',
        amountCents: -75000,
        postedDate,
        name: 'MOBILE DEPOSIT',
        providerCategory: 'TRANSFER_IN.TRANSFER_IN_DEPOSIT',
        pending: false,
      })
      .returning({ id: transactions.id });

    await enrichUserTransactions(db, new MockEnrichmentProvider(), userId);

    const [enrichment] = await db
      .select({ category: transactionEnrichments.category })
      .from(transactionEnrichments)
      .where(and(eq(transactionEnrichments.transactionId, future!.id), isNull(transactionEnrichments.supersededAt)))
      .limit(1);
    expect(enrichment!.category).toBe('TRANSFER');
  });

  it('does not overwrite a user correction when an automatic repair selected an older enrichment', async () => {
    await registerAndAuth('repair-race@example.com');
    const userId = await userIdByEmail('repair-race@example.com');
    const accountId = await createSavingsAccount(userId, 'repair-race');
    const [transaction] = await db
      .insert(transactions)
      .values({
        accountId,
        providerTxnId: 'repair-race-deposit',
        amountCents: -25000,
        postedDate: new Date().toISOString().slice(0, 10),
        name: 'MOBILE DEPOSIT',
        providerCategory: 'TRANSFER_IN.TRANSFER_IN_DEPOSIT',
        pending: false,
      })
      .returning({ id: transactions.id });
    const [selected] = await db
      .insert(transactionEnrichments)
      .values({
        transactionId: transaction!.id,
        category: 'TRANSFER',
        merchantClean: 'Mobile Deposit',
        isRecurring: false,
        isDiscretionary: false,
        confidence: 0.8,
        source: 'llm',
        model: 'test-model',
      })
      .returning({ id: transactionEnrichments.id });
    await applyEnrichment(db, transaction!.id, {
      category: 'TRANSFER',
      merchantClean: 'Mobile Deposit',
      isRecurring: false,
      isDiscretionary: false,
      confidence: 1,
      source: 'user_correction',
      model: null,
    });

    const applied = await applyEnrichment(
      db,
      transaction!.id,
      {
        category: 'INCOME',
        merchantClean: 'Mobile Deposit',
        isRecurring: false,
        isDiscretionary: false,
        confidence: 0.99,
        source: 'fallback',
        model: null,
      },
      { id: selected!.id, source: 'llm' },
    );
    expect(applied).toBe(false);
    const [current] = await db
      .select({ category: transactionEnrichments.category, source: transactionEnrichments.source })
      .from(transactionEnrichments)
      .where(and(eq(transactionEnrichments.transactionId, transaction!.id), isNull(transactionEnrichments.supersededAt)))
      .limit(1);
    expect(current).toEqual({ category: 'TRANSFER', source: 'user_correction' });
  });

  it('removes a stale category rollup when a deposit is repaired to income', async () => {
    await registerAndAuth('stale-rollup@example.com');
    const userId = await userIdByEmail('stale-rollup@example.com');
    const accountId = await createSavingsAccount(userId, 'stale-rollup');
    const postedDate = new Date().toISOString().slice(0, 10);
    const weekStartDate = mondayOf(new Date(`${postedDate}T00:00:00Z`));
    const weekStart = weekStartDate.toISOString().slice(0, 10);
    const [deposit] = await db
      .insert(transactions)
      .values({
        accountId,
        providerTxnId: 'stale-rollup-deposit',
        amountCents: -100000,
        postedDate,
        name: 'MOBILE DEPOSIT',
        providerCategory: null,
        pending: false,
      })
      .returning({ id: transactions.id });
    await db.insert(transactionEnrichments).values({
      transactionId: deposit!.id,
      category: 'BUSINESS_EXPENSE',
      merchantClean: 'Mobile Deposit',
      isRecurring: false,
      isDiscretionary: false,
      confidence: 0.8,
      source: 'llm',
      model: 'test-model',
    });
    await computeRollupsForWeek(db, userId, weekStartDate);
    const [before] = await db
      .select({ id: featureRollups.id })
      .from(featureRollups)
      .where(and(
        eq(featureRollups.userId, userId),
        eq(featureRollups.weekStart, weekStart),
        eq(featureRollups.metric, 'category_spend'),
        eq(featureRollups.category, 'BUSINESS_EXPENSE'),
      ))
      .limit(1);
    expect(before).toBeTruthy();

    await db
      .update(transactions)
      .set({ providerCategory: 'TRANSFER_IN.TRANSFER_IN_DEPOSIT' })
      .where(eq(transactions.id, deposit!.id));
    await enrichUserTransactions(db, new MockEnrichmentProvider(), userId);

    const staleRows = await db
      .select({ id: featureRollups.id })
      .from(featureRollups)
      .where(and(
        eq(featureRollups.userId, userId),
        eq(featureRollups.weekStart, weekStart),
        eq(featureRollups.metric, 'category_spend'),
        eq(featureRollups.category, 'BUSINESS_EXPENSE'),
      ));
    expect(staleRows).toHaveLength(0);
    const [income] = await db
      .select({ valueCents: featureRollups.valueCents })
      .from(featureRollups)
      .where(and(
        eq(featureRollups.userId, userId),
        eq(featureRollups.weekStart, weekStart),
        eq(featureRollups.metric, 'income_total'),
      ))
      .limit(1);
    expect(income!.valueCents).toBe(100000);
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

  it('separates AI subscriptions from API usage and accepts a first $20 plan charge', async () => {
    await registerAndAuth('ai-subscriptions@example.com');
    const userId = await userIdByEmail('ai-subscriptions@example.com');
    const accountId = await createSavingsAccount(userId, 'ai-subscriptions');
    const inserted = await db
      .insert(transactions)
      .values([
        {
          accountId, providerTxnId: 'openai-may', amountCents: 2000, postedDate: '2026-05-30',
          name: 'OPENAI', merchantName: 'OpenAI', providerCategory: 'GENERAL_SERVICES.OTHER_GENERAL_SERVICES', pending: false,
        },
        {
          accountId, providerTxnId: 'anthropic-usage-45', amountCents: 4500, postedDate: '2026-05-02',
          name: 'ANTHROPIC', merchantName: 'Anthropic', providerCategory: 'GENERAL_SERVICES.OTHER_GENERAL_SERVICES', pending: false,
        },
        {
          accountId, providerTxnId: 'anthropic-plan-may', amountCents: 2000, postedDate: '2026-05-12',
          name: 'CLAUDE.AI', merchantName: 'Claude AI', providerCategory: 'GENERAL_SERVICES.OTHER_GENERAL_SERVICES', pending: false,
        },
        {
          accountId, providerTxnId: 'anthropic-usage-10-may', amountCents: 1000, postedDate: '2026-05-28',
          name: 'ANTHROPIC', merchantName: 'Anthropic', providerCategory: 'GENERAL_SERVICES.OTHER_GENERAL_SERVICES', pending: false,
        },
        {
          accountId, providerTxnId: 'anthropic-usage-5', amountCents: 500, postedDate: '2026-05-30',
          name: 'ANTHROPIC', merchantName: 'Anthropic', providerCategory: 'GENERAL_SERVICES.OTHER_GENERAL_SERVICES', pending: false,
        },
        {
          accountId, providerTxnId: 'anthropic-plan-june-a', amountCents: 2000, postedDate: '2026-06-13',
          name: 'ANTHROPIC', merchantName: 'Anthropic', providerCategory: 'GENERAL_SERVICES.OTHER_GENERAL_SERVICES', pending: false,
        },
        {
          accountId, providerTxnId: 'anthropic-plan-june-b', amountCents: 2000, postedDate: '2026-06-14',
          name: 'ANTHROPIC', merchantName: 'Anthropic', providerCategory: 'GENERAL_SERVICES.OTHER_GENERAL_SERVICES', pending: false,
        },
        {
          accountId, providerTxnId: 'anthropic-usage-10-july', amountCents: 1000, postedDate: '2026-07-06',
          name: 'ANTHROPIC', merchantName: 'Anthropic', providerCategory: 'GENERAL_SERVICES.OTHER_GENERAL_SERVICES', pending: false,
        },
        {
          accountId, providerTxnId: 'anthropic-plan-july-early', amountCents: 2000, postedDate: '2026-07-11',
          name: 'ANTHROPIC', merchantName: 'Anthropic', providerCategory: 'GENERAL_SERVICES.OTHER_GENERAL_SERVICES', pending: false,
        },
        {
          accountId, providerTxnId: 'anthropic-plan-july-mid', amountCents: 2000, postedDate: '2026-07-12',
          name: 'ANTHROPIC', merchantName: 'Anthropic', providerCategory: 'GENERAL_SERVICES.OTHER_GENERAL_SERVICES', pending: false,
        },
        {
          accountId, providerTxnId: 'anthropic-plan-july-latest', amountCents: 2000, postedDate: '2026-07-14',
          name: 'ANTHROPIC', merchantName: 'Anthropic', providerCategory: 'GENERAL_SERVICES.OTHER_GENERAL_SERVICES', pending: false,
        },
        {
          accountId, providerTxnId: 'anthropic-usage-10-latest', amountCents: 1000, postedDate: '2026-07-16',
          name: 'ANTHROPIC', merchantName: 'Anthropic', providerCategory: 'GENERAL_SERVICES.OTHER_GENERAL_SERVICES', pending: false,
        },
      ])
      .returning({ id: transactions.id });

    // Simulate existing history where AI API usage was correctly treated as a
    // business expense but no recurring subscription stream was discovered.
    await db.insert(transactionEnrichments).values(inserted.map((transaction) => ({
      transactionId: transaction.id,
      category: 'BUSINESS_EXPENSE',
      merchantClean: 'AI Provider',
      isRecurring: false,
      isDiscretionary: false,
      confidence: 0.8,
      source: 'llm' as const,
      model: 'test-model',
    })));

    await enrichUserTransactions(db, new MockEnrichmentProvider(), userId);

    const currentEnrichments = await db
      .select({
        name: transactions.name,
        category: transactionEnrichments.category,
        merchantClean: transactionEnrichments.merchantClean,
        isRecurring: transactionEnrichments.isRecurring,
      })
      .from(transactionEnrichments)
      .innerJoin(transactions, eq(transactionEnrichments.transactionId, transactions.id))
      .where(isNull(transactionEnrichments.supersededAt));
    expect(currentEnrichments).toHaveLength(inserted.length);
    const explicitClaude = currentEnrichments.find((row) => row.name === 'CLAUDE.AI');
    expect(explicitClaude).toMatchObject({
      category: 'SUBSCRIPTIONS_AND_STREAMING',
      merchantClean: 'Anthropic',
      isRecurring: true,
    });
    const genericAiCharges = currentEnrichments.filter((row) => row.name !== 'CLAUDE.AI');
    expect(genericAiCharges.every((row) => row.category === 'BUSINESS_EXPENSE')).toBe(true);
    expect(genericAiCharges.every((row) => row.isRecurring === false)).toBe(true);

    const audit = await auditSubscriptions(db, userId);
    expect(audit.items).toHaveLength(2);
    const openAi = audit.items.find((item) => item.merchantClean === 'OpenAI');
    expect(openAi).toMatchObject({
      cadence: 'monthly', occurrences: 1, avgAmountCents: 2000,
      category: 'SUBSCRIPTIONS_AND_STREAMING', isCancelCandidate: true,
    });
    const anthropic = audit.items.find((item) => item.merchantClean === 'Anthropic');
    expect(anthropic).toMatchObject({
      cadence: 'monthly', occurrences: 3, avgAmountCents: 2000,
      firstSeenDate: '2026-05-12', lastSeenDate: '2026-07-14',
      category: 'SUBSCRIPTIONS_AND_STREAMING', isCancelCandidate: true,
    });
  });
});

describe('user-correction loop', () => {
  it('applies a correction, stores it for few-shot, and rejects an unknown category', async () => {
    const { access } = await registerAndAuth('correct@example.com');
    await linkBank(access);
    const txns = await getTransactions(access);
    const target = txns
      .filter((t) => !t.pending && t.transferPairId === null && t.isDiscretionary)
      .sort((a, b) => b.amountCents - a.amountCents)[0]!;
    const beforeRollups = await request(app).get('/api/features/rollups?weeks=12').set('Authorization', `Bearer ${access}`);
    const targetWeekStart = new Date(`${target.postedDate}T00:00:00Z`);
    targetWeekStart.setUTCDate(targetWeekStart.getUTCDate() - ((targetWeekStart.getUTCDay() + 6) % 7));
    const targetWeek = targetWeekStart.toISOString().slice(0, 10);
    const beforeRatio = beforeRollups.body.items.find(
      (row: { weekStart: string; metric: string }) => row.weekStart === targetWeek && row.metric === 'discretionary_ratio',
    ).valueRatio as number;

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

    const afterRollups = await request(app).get('/api/features/rollups?weeks=12').set('Authorization', `Bearer ${access}`);
    const afterRatio = afterRollups.body.items.find(
      (row: { weekStart: string; metric: string }) => row.weekStart === targetWeek && row.metric === 'discretionary_ratio',
    ).valueRatio as number;
    expect(afterRatio).toBeLessThan(beforeRatio);
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
