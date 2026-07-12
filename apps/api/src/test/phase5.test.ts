import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { billingEntitlements, users } from '../db/schema.js';
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

async function userIdByEmail(email: string): Promise<number> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  return row!.id;
}

async function grantPremium(email: string): Promise<void> {
  await db.insert(billingEntitlements).values({
    userId: await userIdByEmail(email),
    entitlementId: 'zen_coach',
    status: 'active',
    plan: 'monthly',
    productId: 'com.rushingtechnologies.zenfinance.coach.monthly',
    environment: 'SANDBOX',
    source: 'manual_test',
  });
}

async function linkBank(access: string, publicToken: string): Promise<request.Response> {
  return request(app)
    .post('/api/link/exchange')
    .set('Authorization', `Bearer ${access}`)
    .send({ publicToken, institutionName: 'Mock Bank' });
}

function revenueCatSignature(raw: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = crypto
    .createHmac('sha256', 'test-revenuecat-signing-secret')
    .update(`${timestamp}.${raw}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

describe('Phase 5 RevenueCat billing and monetization', () => {
  it('returns a stable billing status, paywall packages, limits, and pricing assignment', async () => {
    const { access } = await registerAndAuth('billing-status@example.com');

    const res = await request(app).get('/api/billing/status').set('Authorization', `Bearer ${access}`);

    expect(res.status).toBe(200);
    expect(res.body.appUserId).toMatch(/^zenfinance:\d+$/);
    expect(res.body.entitlementId).toBe('zen_coach');
    expect(res.body.isPremium).toBe(false);
    expect(res.body.status).toBe('free');
    expect(res.body.limits).toMatchObject({
      maxLinkedItems: 2,
      maxActiveGoals: 1,
      weeklyBriefsOnly: true,
      premiumFeatures: false,
    });
    expect(res.body.packages.map((p: { productId: string }) => p.productId)).toEqual([
      'com.rushingtechnologies.zenfinance.coach.monthly',
      'com.rushingtechnologies.zenfinance.coach.annual',
    ]);
    expect(res.body.pricingExperiment.experimentId).toBe('paywall_money_wins_v1');
    expect(['control', 'money_wins']).toContain(res.body.pricingExperiment.variant);
  });

  it('enforces free-tier caps and premium feature gates', async () => {
    const { access } = await registerAndAuth('free-gates@example.com');

    const firstLink = await linkBank(access, 'mock-free-link-1');
    expect(firstLink.status).toBe(201);
    const secondLink = await linkBank(access, 'mock-free-link-2');
    expect(secondLink.status).toBe(201);
    const thirdLink = await linkBank(access, 'mock-free-link-3');
    expect(thirdLink.status).toBe(402);
    expect(thirdLink.body.error.code).toBe('premium_required');
    expect(thirdLink.body.error.details.feature).toBe('unlimited_accounts');

    const firstGoal = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'Starter goal', targetAmountCents: 100000 });
    expect(firstGoal.status).toBe(201);
    const secondGoal = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'Second goal', targetAmountCents: 200000 });
    expect(secondGoal.status).toBe(402);
    expect(secondGoal.body.error.details.feature).toBe('multiple_goals');

    const chat = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${access}`)
      .send({ question: 'Can I afford $600?' });
    expect(chat.status).toBe(402);
    expect(chat.body.error.details.feature).toBe('chat_coach');

    const subs = await request(app).get('/api/subscriptions').set('Authorization', `Bearer ${access}`);
    expect(subs.status).toBe(402);
    expect(subs.body.error.details.feature).toBe('subscription_audit');

    const home = await request(app).get('/api/mobile/home').set('Authorization', `Bearer ${access}`);
    expect(home.status).toBe(200);
    expect(home.body.billing.isPremium).toBe(false);
    expect(home.body.subscriptionAudit.totalMonthlyCents).toBe(0);
    expect(home.body.subscriptionAudit.items).toEqual([]);
  });

  it('accepts signed RevenueCat webhooks, updates entitlement state, and ignores duplicate events', async () => {
    const { access } = await registerAndAuth('webhook-premium@example.com');
    const before = await request(app).get('/api/billing/status').set('Authorization', `Bearer ${access}`);
    const now = Date.now();
    const payload = {
      api_version: '1.0',
      event: {
        id: 'evt-premium-1',
        type: 'INITIAL_PURCHASE',
        app_user_id: before.body.appUserId,
        entitlement_ids: ['zen_coach'],
        product_id: 'com.rushingtechnologies.zenfinance.coach.monthly',
        environment: 'SANDBOX',
        event_timestamp_ms: now,
        purchased_at_ms: now,
        expiration_at_ms: now + 30 * 86400000,
        store: 'APP_STORE',
      },
    };
    const raw = JSON.stringify(payload);

    const webhook = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', 'Bearer test-revenuecat-webhook-auth')
      .set('X-RevenueCat-Webhook-Signature', revenueCatSignature(raw))
      .set('Content-Type', 'application/json')
      .send(raw);
    expect(webhook.status).toBe(200);
    expect(webhook.body).toEqual({ ok: true, duplicate: false });

    const duplicate = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', 'Bearer test-revenuecat-webhook-auth')
      .set('X-RevenueCat-Webhook-Signature', revenueCatSignature(raw))
      .set('Content-Type', 'application/json')
      .send(raw);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual({ ok: true, duplicate: true });

    const after = await request(app).get('/api/billing/status').set('Authorization', `Bearer ${access}`);
    expect(after.status).toBe(200);
    expect(after.body.isPremium).toBe(true);
    expect(after.body.status).toBe('active');
    expect(after.body.plan).toBe('monthly');
    expect(after.body.limits.maxLinkedItems).toBeNull();
  });

  it('rejects RevenueCat webhooks with bad auth or bad signatures', async () => {
    const { access } = await registerAndAuth('webhook-reject@example.com');
    const status = await request(app).get('/api/billing/status').set('Authorization', `Bearer ${access}`);
    const raw = JSON.stringify({
      api_version: '1.0',
      event: {
        id: 'evt-reject-1',
        type: 'INITIAL_PURCHASE',
        app_user_id: status.body.appUserId,
        entitlement_ids: ['zen_coach'],
        product_id: 'com.rushingtechnologies.zenfinance.coach.monthly',
        expiration_at_ms: Date.now() + 86400000,
      },
    });

    const badAuth = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', 'Bearer wrong')
      .set('X-RevenueCat-Webhook-Signature', revenueCatSignature(raw))
      .set('Content-Type', 'application/json')
      .send(raw);
    expect(badAuth.status).toBe(401);
    expect(badAuth.body.error.code).toBe('unauthorized');

    const badSig = await request(app)
      .post('/api/webhooks/revenuecat')
      .set('Authorization', 'Bearer test-revenuecat-webhook-auth')
      .set('X-RevenueCat-Webhook-Signature', 't=1234567890,v1=not-a-real-signature')
      .set('Content-Type', 'application/json')
      .send(raw);
    expect(badSig.status).toBe(401);
    expect(badSig.body.error.code).toBe('invalid_signature');
  });

  it('unlocks premium routes and removes caps for premium users', async () => {
    const { access } = await registerAndAuth('premium-unlocked@example.com');
    await grantPremium('premium-unlocked@example.com');

    const firstGoal = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'Goal one', targetAmountCents: 100000 });
    expect(firstGoal.status).toBe(201);
    const secondGoal = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'Goal two', targetAmountCents: 200000 });
    expect(secondGoal.status).toBe(201);

    const chat = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${access}`)
      .send({ question: 'Can I afford $600?' });
    expect(chat.status).toBe(201);

    const subscriptions = await request(app).get('/api/subscriptions').set('Authorization', `Bearer ${access}`);
    expect(subscriptions.status).toBe(200);
    expect(Array.isArray(subscriptions.body.items)).toBe(true);
  });
});
