import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { billingEntitlements, users, voiceBriefs } from '../db/schema.js';
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

describe('Phase 10 Voice Briefs', () => {
  it('premium-gates voice brief generation', async () => {
    const user = await register('voice-free@example.com');
    await linkBank(user.access, 'voice-free-token');

    const res = await request(app).get('/api/voice-brief/latest').set('Authorization', `Bearer ${user.access}`);

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('premium_required');
    expect(res.body.error.details.feature).toBe('voice_brief');
  });

  it('creates an idempotent spoken script from the latest brief', async () => {
    const user = await register('voice-premium@example.com');
    await grantPremium(user.userId);
    await linkBank(user.access, 'voice-premium-token');

    const first = await request(app).get('/api/voice-brief/latest').set('Authorization', `Bearer ${user.access}`);
    expect(first.status).toBe(200);
    expect(first.body.script).toContain('ZenFinance');
    expect(first.body.script).toContain(first.body.headline);
    expect(first.body.durationSeconds).toBeGreaterThan(10);
    expect(first.body.durationSeconds).toBeLessThanOrEqual(90);
    expect(first.body.segments.map((s: { label: string }) => s.label)).toEqual(['intro', 'summary', 'action', 'closing']);

    const second = await request(app).get('/api/voice-brief/latest').set('Authorization', `Bearer ${user.access}`);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const rows = await db.select().from(voiceBriefs);
    expect(rows).toHaveLength(1);
  });

  it('tracks playback events, export rows, and admin metrics', async () => {
    const user = await register('voice-events@example.com');
    await grantPremium(user.userId);
    await linkBank(user.access, 'voice-events-token');
    const voice = await request(app).get('/api/voice-brief/latest').set('Authorization', `Bearer ${user.access}`);
    expect(voice.status).toBe(200);

    const started = await request(app)
      .post(`/api/voice-briefs/${voice.body.id}/events`)
      .set('Authorization', `Bearer ${user.access}`)
      .send({ event: 'started' });
    expect(started.status).toBe(200);
    const completed = await request(app)
      .post(`/api/voice-briefs/${voice.body.id}/events`)
      .set('Authorization', `Bearer ${user.access}`)
      .send({ event: 'completed', positionSeconds: voice.body.durationSeconds });
    expect(completed.status).toBe(200);

    const exported = await request(app).get('/api/me/export').set('Authorization', `Bearer ${user.access}`);
    expect(exported.status).toBe(200);
    expect(exported.body.voiceBriefs[0].id).toBe(voice.body.id);
    expect(exported.body.voiceBriefs[0].completedAt).toBeTruthy();

    const admin = await adminAccess();
    const metrics = await request(app).get('/api/admin/metrics').set('Authorization', `Bearer ${admin}`);
    expect(metrics.status).toBe(200);
    expect(metrics.body.voice.generatedBriefs).toBe(1);
    expect(metrics.body.voice.completedBriefs).toBe(1);
    expect(metrics.body.voice.avgDurationSeconds).toBeGreaterThan(10);
  });
});
