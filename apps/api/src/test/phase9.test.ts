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

async function register(email: string): Promise<{ access: string; userId: number }> {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'a-strong-password' });
  expect(res.status).toBe(201);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  return { access: res.body.accessToken as string, userId: user!.id };
}

async function grantPremium(userId: number): Promise<void> {
  await db.insert(billingEntitlements).values({
    userId,
    entitlementId: 'zen_coach',
    status: 'active',
    plan: 'monthly',
    productId: 'com.rushingtechnologies.zenfinance.coach.monthly',
    environment: 'SANDBOX',
    source: 'manual_test',
  });
}

async function adminAccess(): Promise<string> {
  const res = await request(app)
    .post('/api/admin/login')
    .send({ secret: 'test-admin-secret-0123456789abcdef0123456789ab' });
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
}

describe('Phase 9 Household Sharing', () => {
  it('premium-gates household creation', async () => {
    const user = await register('household-free@example.com');

    const res = await request(app)
      .post('/api/household')
      .set('Authorization', `Bearer ${user.access}`)
      .send({ name: 'Home' });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('premium_required');
    expect(res.body.error.details.feature).toBe('household_sharing');
  });

  it('creates a two-seat household, accepts invites, and keeps private data out of the shared view', async () => {
    const owner = await register('household-owner@example.com');
    const member = await register('household-member@example.com');
    await grantPremium(owner.userId);

    const created = await request(app)
      .post('/api/household')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ name: 'Rushing Home' });
    expect(created.status).toBe(201);
    expect(created.body.household.members).toHaveLength(1);
    expect(created.body.household.members[0].role).toBe('owner');

    const invite = await request(app)
      .post('/api/household/invites')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ email: 'household-member@example.com' });
    expect(invite.status).toBe(201);
    expect(invite.body.acceptToken).toMatch(/^hh_/);

    const accepted = await request(app)
      .post('/api/household/invites/accept')
      .set('Authorization', `Bearer ${member.access}`)
      .send({ token: invite.body.acceptToken });
    expect(accepted.status).toBe(200);
    expect(accepted.body.household.members).toHaveLength(2);
    expect(accepted.body.household.privacyMode).toBe('individual');
    expect(JSON.stringify(accepted.body.household)).not.toContain('transactions');
    expect(JSON.stringify(accepted.body.household)).not.toContain('accounts');

    const extraInvite = await request(app)
      .post('/api/household/invites')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ email: 'third@example.com' });
    expect(extraInvite.status).toBe(400);
    expect(extraInvite.body.error.code).toBe('household_full');
  });

  it('supports shared household goals and member contributions', async () => {
    const owner = await register('goal-owner@example.com');
    const member = await register('goal-member@example.com');
    await grantPremium(owner.userId);
    await request(app).post('/api/household').set('Authorization', `Bearer ${owner.access}`).send({ name: 'Home' });
    const invite = await request(app)
      .post('/api/household/invites')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ email: 'goal-member@example.com' });
    await request(app)
      .post('/api/household/invites/accept')
      .set('Authorization', `Bearer ${member.access}`)
      .send({ token: invite.body.acceptToken });

    const goal = await request(app)
      .post('/api/household/goals')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ name: 'Family emergency fund', targetAmountCents: 500000, currentAmountCents: 100000 });
    expect(goal.status).toBe(201);
    const goalId = goal.body.household.goals[0].id;

    const contribution = await request(app)
      .post(`/api/household/goals/${goalId}/contributions`)
      .set('Authorization', `Bearer ${member.access}`)
      .send({ amountCents: 75000, note: 'Payday' });
    expect(contribution.status).toBe(201);
    expect(contribution.body.household.goals[0].currentAmountCents).toBe(175000);
    expect(contribution.body.household.goals[0].remainingAmountCents).toBe(325000);
    expect(contribution.body.household.goals[0].contributions[0].userEmail).toBe('goal-member@example.com');

    const ownerView = await request(app).get('/api/household').set('Authorization', `Bearer ${owner.access}`);
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.household.goals[0].progressRatio).toBeCloseTo(0.35);
  });

  it('includes household data in export and reports admin metrics', async () => {
    const owner = await register('metrics-owner@example.com');
    const member = await register('metrics-member@example.com');
    await grantPremium(owner.userId);
    await request(app).post('/api/household').set('Authorization', `Bearer ${owner.access}`).send({ name: 'Metrics Home' });
    const invite = await request(app)
      .post('/api/household/invites')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ email: 'metrics-member@example.com' });
    await request(app)
      .post('/api/household/invites/accept')
      .set('Authorization', `Bearer ${member.access}`)
      .send({ token: invite.body.acceptToken });
    await request(app)
      .post('/api/household/goals')
      .set('Authorization', `Bearer ${owner.access}`)
      .send({ name: 'Shared vacation', targetAmountCents: 300000 });

    const exported = await request(app).get('/api/me/export').set('Authorization', `Bearer ${owner.access}`);
    expect(exported.status).toBe(200);
    expect(exported.body.household.household.name).toBe('Metrics Home');
    expect(exported.body.household.household.goals[0].name).toBe('Shared vacation');

    const admin = await adminAccess();
    const metrics = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${admin}`);
    expect(metrics.status).toBe(200);
    expect(metrics.body.household.households).toBe(1);
    expect(metrics.body.household.activeMembers).toBe(2);
    expect(metrics.body.household.pendingInvites).toBe(0);
    expect(metrics.body.household.sharedGoals).toBe(1);
  });
});
