import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { appEvents, insights, items, privacyDeletionEvents, users } from '../db/schema.js';
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

async function linkBank(access: string, token = 'mock-phase6-token'): Promise<void> {
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

describe('Phase 6 hardening, compliance, and beta readiness', () => {
  it('exports authenticated user data without provider access tokens', async () => {
    const { access } = await register('export@example.com');
    await linkBank(access);

    const res = await request(app).get('/api/me/export').set('Authorization', `Bearer ${access}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('export@example.com');
    expect(res.body.items.length).toBe(1);
    expect(res.body.transactions.length).toBeGreaterThan(0);
    expect(res.body.billing.appUserId).toMatch(/^zenfinance:\d+$/);
    expect(JSON.stringify(res.body)).not.toContain('mock-access');
    expect(JSON.stringify(res.body)).not.toContain('encryptedAccessToken');
  });

  it('deletes an account and keeps only non-PII deletion evidence', async () => {
    const { access } = await register('delete-me@example.com');
    await linkBank(access);

    const del = await request(app).delete('/api/me').set('Authorization', `Bearer ${access}`);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);
    expect(del.body.deletionEventId).toBeGreaterThan(0);

    const [event] = await db.select().from(privacyDeletionEvents).limit(1);
    expect(event).toBeTruthy();
    expect(event!.userId).toBeNull();
    expect(event!.emailHash).not.toContain('delete-me@example.com');
    expect(event!.itemCount).toBe(1);
    expect(event!.providerRevocationFailures).toBe(0);
    expect(event!.completedAt).toBeTruthy();

    const login = await request(app).post('/api/auth/login').send({ email: 'delete-me@example.com', password: 'a-strong-password' });
    expect(login.status).toBe(401);
  });

  it('updates item state from Plaid reauth, expiration, repair, and revocation webhooks', async () => {
    const { access } = await register('plaid-state@example.com');
    await linkBank(access);
    const [item] = await db.select().from(items).limit(1);

    const loginRequired = await request(app).post('/api/webhooks/plaid').send({
      webhook_type: 'ITEM',
      webhook_code: 'ERROR',
      item_id: item!.providerItemId,
      error: { error_code: 'ITEM_LOGIN_REQUIRED' },
    });
    expect(loginRequired.status).toBe(200);
    let list = await request(app).get('/api/items').set('Authorization', `Bearer ${access}`);
    expect(list.body.items[0].status).toBe('login_required');

    const repaired = await request(app).post('/api/webhooks/plaid').send({
      webhook_type: 'ITEM',
      webhook_code: 'LOGIN_REPAIRED',
      item_id: item!.providerItemId,
    });
    expect(repaired.status).toBe(200);
    list = await request(app).get('/api/items').set('Authorization', `Bearer ${access}`);
    expect(list.body.items[0].status).toBe('active');

    const revoked = await request(app).post('/api/webhooks/plaid').send({
      webhook_type: 'ITEM',
      webhook_code: 'USER_PERMISSION_REVOKED',
      item_id: item!.providerItemId,
    });
    expect(revoked.status).toBe(200);
    list = await request(app).get('/api/items').set('Authorization', `Bearer ${access}`);
    expect(list.body.items[0].status).toBe('disconnected');
  });

  it('reports beta activation, action, and week-4 retention metrics', async () => {
    const { access, userId } = await register('beta@example.com');
    await linkBank(access);
    const [brief] = await db
      .select({ id: insights.id })
      .from(insights)
      .where(eq(insights.userId, userId))
      .limit(1);
    await request(app)
      .post(`/api/insights/${brief!.id}/feedback`)
      .set('Authorization', `Bearer ${access}`)
      .send({ rating: 'up', followedThrough: true });
    await db.update(users).set({ createdAt: new Date(Date.now() - 35 * 86400000) }).where(eq(users.id, userId));
    await db.insert(appEvents).values({ userId, name: 'beta:week4_active', createdAt: new Date() });

    const token = await adminAccess();
    const metrics = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${token}`);

    expect(metrics.status).toBe(200);
    expect(metrics.body.beta.registeredUsers).toBe(1);
    expect(metrics.body.beta.linkedUsers).toBe(1);
    expect(metrics.body.beta.firstBriefUsers).toBe(1);
    expect(metrics.body.beta.actedUsers).toBe(1);
    expect(metrics.body.beta.retainedWeek4Users).toBe(1);
    expect(metrics.body.beta.activationRate).toBe(1);
    expect(metrics.body.beta.week4RetentionRate).toBe(1);
  });
});
