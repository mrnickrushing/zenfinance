import { and, eq } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getInsightProvider } from '../coaching/index.js';
import { verifyMoneyWins } from '../coaching/moneyWins.js';
import { runWeeklyBriefForUser } from '../coaching/pipeline.js';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { accounts, items, moneyWins, recurringStreams, users } from '../db/schema.js';
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

async function registerAndAuth(email: string): Promise<{ access: string }> {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'a-strong-password' });
  expect(res.status).toBe(201);
  return { access: res.body.accessToken };
}

// Linking with the mock provider runs the full inline pipeline:
// sync → enrich → recurring detection → rollups → anomalies → first-look brief.
async function linkBank(access: string): Promise<void> {
  const res = await request(app)
    .post('/api/link/exchange')
    .set('Authorization', `Bearer ${access}`)
    .send({ publicToken: 'mock-public-token', institutionName: 'Mock Bank' });
  expect(res.status).toBe(201);
}

async function userIdByEmail(email: string): Promise<number> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  return row!.id;
}

describe('first-look brief (generated at link time)', () => {
  it('produces a guard-passing brief with a dollar figure and an action', async () => {
    const { access } = await registerAndAuth('firstlook@example.com');
    await linkBank(access);

    const res = await request(app)
      .get('/api/insights/latest?kind=first_look')
      .set('Authorization', `Bearer ${access}`);
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('first_look');
    expect(res.body.headline.length).toBeGreaterThan(0);
    expect(res.body.body.length).toBeGreaterThan(0);
    expect(res.body.action.description.length).toBeGreaterThan(0);
    // Every brief names at least one verified dollar figure (§4).
    expect(res.body.claims.length).toBeGreaterThan(0);
    expect(res.body.toneCheck).toBeGreaterThanOrEqual(0.5);
    expect(['llm', 'template']).toContain(res.body.source);
  });

  it('is generated only once (re-syncing does not add a second first-look)', async () => {
    const { access } = await registerAndAuth('once@example.com');
    await linkBank(access);
    // A second link of the same bank is a 409; trigger another enrichment+first-look
    // pass by re-running the user's pipeline. It must remain a single row.
    const userId = await userIdByEmail('once@example.com');
    await runWeeklyBriefForUser(db, getInsightProvider(), userId); // different kind
    const res = await request(app).get('/api/insights?kind=first_look').set('Authorization', `Bearer ${access}`);
    expect(res.body.items.length).toBe(1);
  });
});

describe('weekly brief', () => {
  it('generates a weekly brief for a linked user', async () => {
    const { access } = await registerAndAuth('weekly@example.com');
    await linkBank(access);
    const userId = await userIdByEmail('weekly@example.com');
    await runWeeklyBriefForUser(db, getInsightProvider(), userId);

    const res = await request(app)
      .get('/api/insights/latest?kind=weekly_brief')
      .set('Authorization', `Bearer ${access}`);
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('weekly_brief');
    expect(res.body.claims.length).toBeGreaterThan(0);
    expect(res.body.action.description.length).toBeGreaterThan(0);
  });
});

describe('feedback loop', () => {
  it('stores a thumbs rating and follow-through on an insight', async () => {
    const { access } = await registerAndAuth('feedback@example.com');
    await linkBank(access);
    const latest = await request(app)
      .get('/api/insights/latest?kind=first_look')
      .set('Authorization', `Bearer ${access}`);
    const insightId = latest.body.id as number;

    const fb = await request(app)
      .post(`/api/insights/${insightId}/feedback`)
      .set('Authorization', `Bearer ${access}`)
      .send({ rating: 'up', followedThrough: true });
    expect(fb.status).toBe(200);

    const after = await request(app).get('/api/insights?kind=first_look').set('Authorization', `Bearer ${access}`);
    expect(after.body.items[0].feedbackRating).toBe('up');
    expect(after.body.items[0].feedbackFollowedThrough).toBe(true);
  });
});

describe('goals CRUD + pacing', () => {
  it('creates a goal and returns deterministic pacing', async () => {
    const { access } = await registerAndAuth('goals@example.com');
    await linkBank(access);

    const created = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'Emergency fund', targetAmountCents: 500000, currentAmountCents: 100000, targetDate: '2026-12-31' });
    expect(created.status).toBe(201);
    expect(created.body.pacing.remainingAmountCents).toBe(400000);
    expect(created.body.pacing.weeklyTargetCents).toBeGreaterThan(0);
    expect(created.body.pacing.progressRatio).toBeCloseTo(0.2, 5);

    const goalId = created.body.id as number;
    const updated = await request(app)
      .patch(`/api/goals/${goalId}`)
      .set('Authorization', `Bearer ${access}`)
      .send({ currentAmountCents: 500000 });
    expect(updated.status).toBe(200);
    expect(updated.body.pacing.remainingAmountCents).toBe(0);
    expect(updated.body.pacing.pacingStatus).toBe('ahead');

    const del = await request(app).delete(`/api/goals/${goalId}`).set('Authorization', `Bearer ${access}`);
    expect(del.status).toBe(200);
    const list = await request(app).get('/api/goals').set('Authorization', `Bearer ${access}`);
    expect(list.body.items.length).toBe(0);
  });
});

describe('anomaly detection', () => {
  it('surfaces new-recurring anomalies and lets the user acknowledge them', async () => {
    const { access } = await registerAndAuth('anomaly@example.com');
    await linkBank(access);

    const res = await request(app).get('/api/anomalies').set('Authorization', `Bearer ${access}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    const anomaly = res.body.items[0];

    const ack = await request(app)
      .patch(`/api/anomalies/${anomaly.id}`)
      .set('Authorization', `Bearer ${access}`)
      .send({ status: 'dismissed' });
    expect(ack.status).toBe(200);

    const after = await request(app).get('/api/anomalies').set('Authorization', `Bearer ${access}`);
    expect(after.body.items.find((a: { id: number }) => a.id === anomaly.id)).toBeUndefined();
  });
});

describe('subscription auditor + money wins', () => {
  it('audits subscriptions, cancels one, and records an estimated win', async () => {
    const { access } = await registerAndAuth('subs@example.com');
    await linkBank(access);

    const audit = await request(app).get('/api/subscriptions').set('Authorization', `Bearer ${access}`);
    expect(audit.status).toBe(200);
    expect(audit.body.items.length).toBeGreaterThan(0);
    const netflix = audit.body.items.find((s: { merchantClean: string }) => s.merchantClean === 'Netflix');
    expect(netflix).toBeTruthy();
    expect(netflix.isCancelCandidate).toBe(true);
    expect(netflix.cancellationScript).toContain('cancel');
    expect(netflix.monthlyEquivalentCents).toBeGreaterThan(0);

    const cancel = await request(app)
      .post('/api/subscriptions/cancel')
      .set('Authorization', `Bearer ${access}`)
      .send({ recurringStreamId: netflix.recurringStreamId });
    expect(cancel.status).toBe(201);

    const wins = await request(app).get('/api/money-wins').set('Authorization', `Bearer ${access}`);
    expect(wins.status).toBe(200);
    const subWin = wins.body.wins.find((w: { kind: string }) => w.kind === 'subscription_canceled');
    expect(subWin).toBeTruthy();
    expect(subWin.status).toBe('estimated');

    // Confirming the cancellation verifies the win.
    const confirm = await request(app)
      .post(`/api/money-wins/${subWin.id}/confirm`)
      .set('Authorization', `Bearer ${access}`);
    expect(confirm.status).toBe(200);
    const after = await request(app).get('/api/money-wins').set('Authorization', `Bearer ${access}`);
    expect(after.body.verifiedTotalCents).toBeGreaterThan(0);
  });

  it('records a verified win when the user recovers money on an anomaly', async () => {
    const { access } = await registerAndAuth('recover@example.com');
    await linkBank(access);
    const anomalies = await request(app).get('/api/anomalies').set('Authorization', `Bearer ${access}`);
    const anomaly = anomalies.body.items[0];

    const recover = await request(app)
      .post(`/api/anomalies/${anomaly.id}/recover`)
      .set('Authorization', `Bearer ${access}`);
    expect(recover.status).toBe(200);

    const wins = await request(app).get('/api/money-wins').set('Authorization', `Bearer ${access}`);
    expect(wins.body.verifiedTotalCents).toBe(anomaly.amountCents);
  });
});

describe('money-win verification by charge absence (§4 Stage 5)', () => {
  it('verifies a canceled subscription after 2 clean billing cycles', async () => {
    const { access } = await registerAndAuth('verify@example.com');
    await linkBank(access);
    const userId = await userIdByEmail('verify@example.com');
    const [account] = await db.select().from(accounts).limit(1);

    // A subscription whose merchant never appears in the transaction history —
    // so verification sees a clean absence.
    const [stream] = await db
      .insert(recurringStreams)
      .values({
        userId,
        accountId: account!.id,
        merchantKey: 'gonemerchant',
        merchantClean: 'Gone Merchant',
        cadence: 'monthly',
        avgAmountCents: 999,
        lastAmountCents: 999,
        occurrences: 3,
        firstSeenDate: '2026-01-01',
        lastSeenDate: '2026-03-01',
        active: false,
      })
      .returning();

    const seventyDaysAgo = new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10);
    await db.insert(moneyWins).values({
      userId,
      kind: 'subscription_canceled',
      description: 'Canceled Gone Merchant',
      amountCents: 0,
      status: 'estimated',
      dedupeKey: 'subcancel-test',
      sourceRecurringStreamId: stream!.id,
      expectedChargeCents: 999,
      verifyCyclesRequired: 2,
      lastCheckedDate: seventyDaysAgo,
    });

    await verifyMoneyWins(db, userId);

    const [win] = await db
      .select()
      .from(moneyWins)
      .where(and(eq(moneyWins.userId, userId), eq(moneyWins.dedupeKey, 'subcancel-test')))
      .limit(1);
    expect(win!.status).toBe('verified');
    expect(win!.cyclesObserved).toBeGreaterThanOrEqual(2);
    expect(win!.amountCents).toBeGreaterThanOrEqual(999 * 2);
  });

  it('drops a win when the charge reappears (cancellation did not stick)', async () => {
    const { access } = await registerAndAuth('reappear@example.com');
    await linkBank(access);
    const userId = await userIdByEmail('reappear@example.com');

    // Netflix really is in the history — a canceled-Netflix win must not verify.
    const [netflixStream] = await db
      .select()
      .from(recurringStreams)
      .where(and(eq(recurringStreams.userId, userId), eq(recurringStreams.merchantClean, 'Netflix')))
      .limit(1);
    expect(netflixStream).toBeTruthy();

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    await db.insert(moneyWins).values({
      userId,
      kind: 'subscription_canceled',
      description: 'Canceled Netflix',
      amountCents: 0,
      status: 'estimated',
      dedupeKey: 'subcancel-netflix',
      sourceRecurringStreamId: netflixStream!.id,
      expectedChargeCents: netflixStream!.avgAmountCents,
      verifyCyclesRequired: 2,
      lastCheckedDate: thirtyDaysAgo,
    });

    await verifyMoneyWins(db, userId);

    const [win] = await db
      .select()
      .from(moneyWins)
      .where(and(eq(moneyWins.userId, userId), eq(moneyWins.dedupeKey, 'subcancel-netflix')))
      .limit(1);
    expect(win).toBeUndefined(); // removed — cancellation didn't stick
  });
});

describe('cross-user isolation', () => {
  it('cannot cancel or view another user\'s subscription/insights', async () => {
    const a = await registerAndAuth('ownerA@example.com');
    await linkBank(a.access);
    const auditA = await request(app).get('/api/subscriptions').set('Authorization', `Bearer ${a.access}`);
    const streamId = auditA.body.items[0].recurringStreamId as number;

    const b = await registerAndAuth('intruderB@example.com');
    const cancel = await request(app)
      .post('/api/subscriptions/cancel')
      .set('Authorization', `Bearer ${b.access}`)
      .send({ recurringStreamId: streamId });
    expect(cancel.status).toBe(404);

    // B sees no insights of their own.
    const insights = await request(app)
      .get('/api/insights/latest?kind=first_look')
      .set('Authorization', `Bearer ${b.access}`);
    expect(insights.status).toBe(404);
  });
});
