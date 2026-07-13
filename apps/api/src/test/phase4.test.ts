import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closeDb, migrateOnce, truncateAll } from './setup.js';
import { db } from '../db/client.js';
import { billingEntitlements, users } from '../db/schema.js';

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

async function registerAndLink(email: string): Promise<{ access: string }> {
  const auth = await request(app).post('/api/auth/register').send({ email, password: 'a-strong-password' });
  expect(auth.status).toBe(201);
  const access = auth.body.accessToken as string;
  const link = await request(app)
    .post('/api/link/exchange')
    .set('Authorization', `Bearer ${access}`)
    .send({ publicToken: 'mock-public-token', institutionName: 'Mock Bank' });
  expect(link.status).toBe(201);
  return { access };
}

async function grantPremium(email: string): Promise<void> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  await db.insert(billingEntitlements).values({
    userId: user!.id,
    entitlementId: 'zen_coach',
    status: 'active',
    plan: 'monthly',
    productId: 'com.rushingtechnologies.zenfinance.coach.monthly',
    environment: 'SANDBOX',
    source: 'manual_test',
  });
}

describe('Phase 4 mobile product API', () => {
  it('returns a complete mobile home summary', async () => {
    const { access } = await registerAndLink('mobile-home@example.com');
    await grantPremium('mobile-home@example.com');
    const res = await request(app).get('/api/mobile/home').set('Authorization', `Bearer ${access}`);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.transactionCount).toBeGreaterThan(0);
    expect(res.body.firstLook.headline).toBeTruthy();
    expect(Array.isArray(res.body.goals)).toBe(true);
    expect(res.body.subscriptionAudit.totalMonthlyCents).toBeGreaterThan(0);
    expect(Array.isArray(res.body.recentTransactions)).toBe(true);
  });

  it('answers chat questions using scoped transaction data', async () => {
    const { access } = await registerAndLink('chat@example.com');
    await grantPremium('chat@example.com');
    const res = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${access}`)
      .send({ question: 'How much did I spend on Netflix in the last 90 days?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toContain('$');
    expect(res.body.facts[0].source).toBe('transaction_query');
    expect(res.body.actions.length).toBeGreaterThan(0);
  });

  it('answers the goal and budget prompts shown by the iOS coach', async () => {
    const email = 'chat-prompts@example.com';
    const { access } = await registerAndLink(email);
    await grantPremium(email);
    await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'Emergency fund', targetAmountCents: 300000, currentAmountCents: 50000, targetDate: '2027-12-31' });

    const goal = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${access}`)
      .send({ question: 'Am I on pace for my top goal?' });
    expect(goal.status).toBe(201);
    expect(goal.body.answer).toContain('Emergency fund');
    expect(goal.body.facts.some((fact: { source: string }) => fact.source === 'goal')).toBe(true);

    const budget = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${access}`)
      .send({ question: 'Help me set a new budget limit.' });
    expect(budget.status).toBe(201);
    expect(budget.body.answer).not.toContain('could not safely tailor');
    expect(budget.body.actions.length).toBeGreaterThan(0);
  });

  it('streams chat answers over server-sent events', async () => {
    const { access } = await registerAndLink('chat-stream@example.com');
    await grantPremium('chat-stream@example.com');
    const res = await request(app)
      .post('/api/chat/stream')
      .set('Authorization', `Bearer ${access}`)
      .send({ question: 'Can I afford $600?' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('event: chunk');
    expect(res.text).toContain('event: done');
  });

  it('runs deterministic what-if simulations without model arithmetic', async () => {
    const { access } = await registerAndLink('whatif@example.com');
    await grantPremium('whatif@example.com');
    const goal = await request(app)
      .post('/api/goals')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'Emergency fund', targetAmountCents: 300000, currentAmountCents: 50000 });
    expect(goal.status).toBe(201);

    const res = await request(app)
      .post('/api/what-if')
      .set('Authorization', `Bearer ${access}`)
      .send({ goalId: goal.body.id, monthlySpendReductionCents: 20000, oneTimeSavingsCents: 25000 });

    expect(res.status).toBe(200);
    expect(res.body.weeklyNetChangeCents).toBeGreaterThan(0);
    expect(res.body.projections[0].remainingAmountCents).toBe(225000);
    expect(res.body.narration).toContain('$');
  });

  it('persists push token and per-type notification preferences', async () => {
    const { access } = await registerAndLink('notifications@example.com');

    const token = await request(app)
      .post('/api/push-tokens')
      .set('Authorization', `Bearer ${access}`)
      .send({ token: 'ExponentPushToken[phase4-test-token]', platform: 'ios' });
    expect(token.status).toBe(201);
    expect(token.body.pushEnabled).toBe(true);

    const prefs = await request(app)
      .patch('/api/notifications/preferences')
      .set('Authorization', `Bearer ${access}`)
      .send({ weeklyBrief: true, anomalies: false, goalPacing: true, marketing: false });
    expect(prefs.status).toBe(200);
    expect(prefs.body.anomalies).toBe(false);

    const after = await request(app).get('/api/notifications/preferences').set('Authorization', `Bearer ${access}`);
    expect(after.body.pushEnabled).toBe(true);
    expect(after.body.weeklyBrief).toBe(true);
    expect(after.body.anomalies).toBe(false);

    const unregistered = await request(app)
      .delete('/api/push-tokens')
      .set('Authorization', `Bearer ${access}`)
      .send({ token: 'ExponentPushToken[phase4-test-token]', platform: 'ios' });
    expect(unregistered.status).toBe(204);
    const disabled = await request(app).get('/api/notifications/preferences').set('Authorization', `Bearer ${access}`);
    expect(disabled.body.pushEnabled).toBe(false);
  });

  it('records app funnel events', async () => {
    const { access } = await registerAndLink('events@example.com');
    const res = await request(app)
      .post('/api/app-events')
      .set('Authorization', `Bearer ${access}`)
      .send({ name: 'onboarding:linked_bank', properties: { source: 'test' } });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });
});
