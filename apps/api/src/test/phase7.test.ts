import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import {
  appEvents,
  billingEntitlements,
  moneyWins,
  referralCredits,
  recurringStreams,
  accounts,
  items,
  users,
} from '../db/schema.js';
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

async function register(email: string): Promise<{ access: string; userId: number }> {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'a-strong-password' });
  expect(res.status).toBe(201);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  return { access: res.body.accessToken, userId: user!.id };
}

async function linkBank(access: string, token: string): Promise<void> {
  const res = await request(app)
    .post('/api/link/exchange')
    .set('Authorization', `Bearer ${access}`)
    .send({ publicToken: token, institutionName: 'Mock Bank' });
  expect(res.status).toBe(201);
}

async function adminAccess(): Promise<string> {
  const res = await request(app)
    .post('/api/admin/login')
    .send({ secret: 'test-admin-secret-0123456789abcdef0123456789ab' });
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
}

describe('Phase 7 launch and growth loop', () => {
  it('redeems a referral code and unlocks 30-day premium credits for both users', async () => {
    const referrer = await register('referrer@example.com');
    const referred = await register('referred@example.com');

    const status = await request(app).get('/api/referrals/me').set('Authorization', `Bearer ${referrer.access}`);
    expect(status.status).toBe(200);
    expect(status.body.code).toMatch(/^ZF[A-F0-9]{8}$/);

    const redeemed = await request(app)
      .post('/api/referrals/redeem')
      .set('Authorization', `Bearer ${referred.access}`)
      .send({ code: status.body.code });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.ok).toBe(true);
    expect(redeemed.body.billing.isPremium).toBe(true);
    expect(redeemed.body.billing.plan).toBe('referral');
    expect(redeemed.body.referral.redeemedCode).toBe(status.body.code);

    const referrerBilling = await request(app).get('/api/billing/status').set('Authorization', `Bearer ${referrer.access}`);
    expect(referrerBilling.status).toBe(200);
    expect(referrerBilling.body.isPremium).toBe(true);
    expect(referrerBilling.body.plan).toBe('referral');

    const credits = await db.select().from(referralCredits);
    expect(credits).toHaveLength(2);
    expect(credits.every((credit) => credit.days === 30)).toBe(true);
  });

  it('rejects self-referrals and duplicate referral redemptions', async () => {
    const owner = await register('owner@example.com');
    const friend = await register('friend@example.com');
    const status = await request(app).get('/api/referrals/me').set('Authorization', `Bearer ${owner.access}`);

    const self = await request(app)
      .post('/api/referrals/redeem')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ code: status.body.code });
    expect(self.status).toBe(400);

    const first = await request(app)
      .post('/api/referrals/redeem')
      .set('Authorization', `Bearer ${friend.access}`)
      .send({ code: status.body.code });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/referrals/redeem')
      .set('Authorization', `Bearer ${friend.access}`)
      .send({ code: status.body.code });
    expect(second.status).toBe(400);
  });

  it('reports launch metrics for paid conversion, MRR, referrals, active users, and Money Wins', async () => {
    const referrer = await register('launch-referrer@example.com');
    const referred = await register('launch-referred@example.com');
    const status = await request(app).get('/api/referrals/me').set('Authorization', `Bearer ${referrer.access}`);
    await request(app)
      .post('/api/referrals/redeem')
      .set('Authorization', `Bearer ${referred.access}`)
      .send({ code: status.body.code });

    await db.insert(appEvents).values([
      { userId: referrer.userId, name: 'launch:open' },
      { userId: referred.userId, name: 'launch:open' },
    ]);
    await db.insert(billingEntitlements).values({
      userId: referrer.userId,
      entitlementId: 'zen_coach',
      status: 'active',
      plan: 'monthly',
      productId: 'com.rushingtechnologies.zenfinance.coach.monthly',
      environment: 'SANDBOX',
      source: 'manual_test',
    });
    await db.insert(moneyWins).values({
      userId: referrer.userId,
      kind: 'fee_refund',
      description: 'Refunded bank fee',
      amountCents: 2500,
      status: 'verified',
      dedupeKey: 'fee-refund-launch',
    });

    const token = await adminAccess();
    const metrics = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${token}`);

    expect(metrics.status).toBe(200);
    expect(metrics.body.launch.activeUsers7Days).toBe(2);
    expect(metrics.body.launch.premiumUsers).toBe(2);
    expect(metrics.body.launch.paidUsers).toBe(1);
    expect(metrics.body.launch.mrrCents).toBe(799);
    expect(metrics.body.launch.verifiedMoneyWinsAvgCents).toBe(1250);
    expect(metrics.body.launch.referralRedemptions).toBe(1);
    expect(metrics.body.launch.referralCreditsAwarded).toBe(2);
  });

  it('serves anonymized launch content stats with sample-size gating', async () => {
    const { access, userId } = await register('content@example.com');
    await linkBank(access, 'mock-content-token');
    const [item] = await db.select({ id: items.id }).from(items).where(eq(items.userId, userId)).limit(1);
    const [account] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.itemId, item!.id)).limit(1);
    await db.insert(recurringStreams).values({
      userId,
      accountId: account!.id,
      merchantKey: 'streammax',
      merchantClean: 'StreamMax',
      cadence: 'monthly',
      avgAmountCents: 1699,
      lastAmountCents: 1699,
      occurrences: 3,
      firstSeenDate: '2026-01-01',
      lastSeenDate: '2026-03-01',
      nextExpectedDate: '2026-04-01',
    });

    const stats = await request(app).get('/api/content/launch-stats');

    expect(stats.status).toBe(200);
    expect(stats.body.sampleSize).toBe(1);
    expect(stats.body.publishable).toBe(false);
    expect(stats.body.metrics.linkedUsers).toBe(1);
    expect(stats.body.metrics.avgRecurringStreamsPerLinkedUser).toBeGreaterThanOrEqual(1);
    expect(stats.body.metrics.avgRecurringMonthlyCentsPerLinkedUser).toBeGreaterThanOrEqual(1699);
  });
});
