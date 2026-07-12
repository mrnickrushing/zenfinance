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

async function linkBank(access: string, token: string): Promise<void> {
  const res = await request(app)
    .post('/api/link/exchange')
    .set('Authorization', `Bearer ${access}`)
    .send({ publicToken: token, institutionName: 'Mock Bank' });
  expect(res.status).toBe(201);
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

describe('Phase 8 Freelancer Mode', () => {
  it('premium-gates freelancer summaries for free users', async () => {
    const user = await register('phase8-free@example.com');
    await linkBank(user.access, 'phase8-free-token');

    const res = await request(app).get('/api/freelancer/summary').set('Authorization', `Bearer ${user.access}`);

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('premium_required');
    expect(res.body.error.details.feature).toBe('freelancer_mode');
  });

  it('persists profile settings and calculates income, set-aside, and runway from linked accounts', async () => {
    const user = await register('phase8-premium@example.com');
    await grantPremium(user.userId);
    await linkBank(user.access, 'phase8-premium-token');

    const profile = await request(app)
      .patch('/api/freelancer/profile')
      .set('Authorization', `Bearer ${user.access}`)
      .send({
        enabled: true,
        targetMonthlyIncomeCents: 800000,
        taxSetAsideBps: 3000,
        runwayTargetMonths: 6,
      });
    expect(profile.status).toBe(200);
    expect(profile.body.targetMonthlyIncomeCents).toBe(800000);
    expect(profile.body.taxSetAsideBps).toBe(3000);
    expect(profile.body.runwayTargetMonths).toBe(6);

    const summary = await request(app).get('/api/freelancer/summary').set('Authorization', `Bearer ${user.access}`);

    expect(summary.status).toBe(200);
    expect(summary.body.profile.targetMonthlyIncomeCents).toBe(800000);
    expect(summary.body.months).toHaveLength(6);
    expect(summary.body.avgMonthlyIncomeCents).toBeGreaterThan(0);
    expect(summary.body.maxMonthlyIncomeCents).toBeGreaterThanOrEqual(summary.body.minMonthlyIncomeCents);
    expect(summary.body.estimatedTaxSetAsideRateBps).toBe(3000);
    expect(summary.body.estimatedTaxSetAsideMonthlyCents).toBe(Math.round(summary.body.avgMonthlyIncomeCents * 0.3));
    expect(summary.body.cashBalanceCents).toBeGreaterThan(0);
    expect(summary.body.runwayMonths).toBeGreaterThan(0);
    expect(summary.body.targetMonthlyIncomeGapCents).toBeGreaterThanOrEqual(0);
    expect(summary.body.recommendations.length).toBeGreaterThan(0);
    expect(JSON.stringify(summary.body.recommendations)).toContain('not tax advice');
  });

  it('reports Freelancer Mode adoption in admin metrics', async () => {
    const user = await register('phase8-admin@example.com');
    await grantPremium(user.userId);
    await linkBank(user.access, 'phase8-admin-token');
    await request(app)
      .patch('/api/freelancer/profile')
      .set('Authorization', `Bearer ${user.access}`)
      .send({ targetMonthlyIncomeCents: 900000, taxSetAsideBps: 2500, runwayTargetMonths: 4 });

    const admin = await adminAccess();
    const metrics = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${admin}`);

    expect(metrics.status).toBe(200);
    expect(metrics.body.freelancer.enabledUsers).toBe(1);
    expect(metrics.body.freelancer.usersWithIncome).toBe(1);
    expect(metrics.body.freelancer.avgRunwayMonths).toBeGreaterThan(0);
    expect(metrics.body.freelancer.avgTargetGapCents).toBeGreaterThanOrEqual(0);
  });
});
