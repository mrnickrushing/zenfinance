import crypto from 'node:crypto';
import { MONEY_PHYSICAL_PRODUCT_ID } from '@zenfinance/shared';
import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { moneyPhysicalReports, users } from '../db/schema.js';
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

async function billingAppUserId(access: string): Promise<string> {
  const res = await request(app).get('/api/billing/status').set('Authorization', `Bearer ${access}`);
  expect(res.status).toBe(200);
  return res.body.appUserId as string;
}

async function adminAccess(): Promise<string> {
  const res = await request(app)
    .post('/api/admin/login')
    .send({ secret: 'test-admin-secret-0123456789abcdef0123456789ab' });
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
}

function revenueCatSignature(raw: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = crypto
    .createHmac('sha256', 'test-revenuecat-signing-secret')
    .update(`${timestamp}.${raw}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

describe('Phase 11 Money Physical', () => {
  it('exposes one-time product status before purchase', async () => {
    const user = await register('physical-status@example.com');

    const res = await request(app).get('/api/money-physical/status').set('Authorization', `Bearer ${user.access}`);

    expect(res.status).toBe(200);
    expect(res.body.productId).toBe(MONEY_PHYSICAL_PRODUCT_ID);
    expect(res.body.priceLabel).toBe('$14.99');
    expect(res.body.purchased).toBe(false);
    expect(res.body.latestReport).toBeNull();
  });

  it('restores a one-time purchase and generates an idempotent 90-day report', async () => {
    const user = await register('physical-restore@example.com');
    await linkBank(user.access, 'physical-restore-token');
    const appUserId = await billingAppUserId(user.access);

    const first = await request(app)
      .post('/api/money-physical/restore')
      .set('Authorization', `Bearer ${user.access}`)
      .send({
        appUserId,
        productId: MONEY_PHYSICAL_PRODUCT_ID,
        transactionId: 'txn-money-physical-restore-1',
        purchaseDate: new Date().toISOString(),
        store: 'APP_STORE',
        environment: 'SANDBOX',
      });

    expect(first.status).toBe(201);
    expect(first.body.productId).toBe(MONEY_PHYSICAL_PRODUCT_ID);
    expect(first.body.score).toBeGreaterThanOrEqual(0);
    expect(first.body.score).toBeLessThanOrEqual(100);
    expect(first.body.sections.cashFlow.spendingCents).toBeGreaterThan(0);
    expect(first.body.sections.spending.topCategories.length).toBeGreaterThan(0);
    expect(first.body.actions.length).toBeGreaterThan(0);

    const second = await request(app)
      .post('/api/money-physical/restore')
      .set('Authorization', `Bearer ${user.access}`)
      .send({
        appUserId,
        productId: MONEY_PHYSICAL_PRODUCT_ID,
        transactionId: 'txn-money-physical-restore-1',
        store: 'APP_STORE',
        environment: 'SANDBOX',
      });
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    const status = await request(app).get('/api/money-physical/status').set('Authorization', `Bearer ${user.access}`);
    expect(status.status).toBe(200);
    expect(status.body.purchased).toBe(true);
    expect(status.body.latestReport.id).toBe(first.body.id);

    const home = await request(app).get('/api/mobile/home').set('Authorization', `Bearer ${user.access}`);
    expect(home.status).toBe(200);
    expect(home.body.moneyPhysical.latestReport.id).toBe(first.body.id);

    const rows = await db.select().from(moneyPhysicalReports);
    expect(rows).toHaveLength(1);
  });

  it('accepts RevenueCat one-time purchase webhooks, exports reports, and reports admin metrics', async () => {
    const user = await register('physical-webhook@example.com');
    await linkBank(user.access, 'physical-webhook-token');
    const appUserId = await billingAppUserId(user.access);
    const now = Date.now();
    const payload = {
      api_version: '1.0',
      event: {
        id: 'evt-money-physical-1',
        type: 'NON_RENEWING_PURCHASE',
        app_user_id: appUserId,
        product_id: MONEY_PHYSICAL_PRODUCT_ID,
        transaction_id: 'txn-money-physical-webhook-1',
        environment: 'SANDBOX',
        event_timestamp_ms: now,
        purchased_at_ms: now,
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

    const exported = await request(app).get('/api/me/export').set('Authorization', `Bearer ${user.access}`);
    expect(exported.status).toBe(200);
    expect(exported.body.moneyPhysicalReports[0].transactionId).toBe('txn-money-physical-webhook-1');

    const admin = await adminAccess();
    const metrics = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${admin}`);
    expect(metrics.status).toBe(200);
    expect(metrics.body.moneyPhysical.purchasedReports).toBe(1);
    expect(metrics.body.moneyPhysical.generatedReports).toBe(1);
    expect(metrics.body.moneyPhysical.avgScore).toBeGreaterThanOrEqual(0);
    expect(metrics.body.moneyPhysical.revenueCents).toBe(1499);
  });
});
