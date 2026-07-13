import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/email.js', () => ({
  sendSupportEmail: vi.fn(async () => false), // simulate Resend being down
}));

import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { supportRequests, waitlistSignups } from '../db/schema.js';
import { sendSupportEmail } from '../lib/email.js';
import { closeDb, migrateOnce, truncateAll } from './setup.js';

let app: Express;

beforeAll(async () => {
  await migrateOnce();
});

beforeEach(async () => {
  await truncateAll();
  // Fresh app per test so each in-memory rate-limiter store starts empty.
  app = createApp();
});

afterAll(async () => {
  await closeDb();
});

describe('GET /health', () => {
  it('returns 200 with db up', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: 'up' });
  });

  it('sets baseline security headers without advertising Express', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('prevents API responses from being cached', async () => {
    const res = await request(app).get('/api/content/launch-stats');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('request body boundary', () => {
  it('returns a safe 400 for malformed JSON', async () => {
    const res = await request(app)
      .post('/api/waitlist')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'invalid_json', message: 'Malformed JSON request body' } });
  });

  it('returns 413 for a JSON body above the configured limit', async () => {
    const res = await request(app)
      .post('/api/support')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'N', email: 'n@example.com', message: 'x'.repeat(140_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('payload_too_large');
  });
});

describe('POST /api/waitlist', () => {
  it('stores a signup', async () => {
    const res = await request(app).post('/api/waitlist').send({ email: 'A@Example.com ' });
    expect(res.status).toBe(201);
    const rows = await db.select().from(waitlistSignups);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe('a@example.com'); // trimmed + lowercased
  });

  it('answers duplicates with 200 and stores nothing new', async () => {
    await request(app).post('/api/waitlist').send({ email: 'a@example.com' });
    const res = await request(app).post('/api/waitlist').send({ email: 'a@example.com' });
    expect(res.status).toBe(200);
    expect(await db.select().from(waitlistSignups)).toHaveLength(1);
  });

  it('rejects invalid emails with 400 and a consistent error shape', async () => {
    const res = await request(app).post('/api/waitlist').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });
});

describe('POST /api/support', () => {
  const ticket = { name: 'Nick', email: 'nick@example.com', message: 'Something went wrong here.' };

  it('persists the ticket even when the support email fails', async () => {
    const res = await request(app).post('/api/support').send(ticket);
    expect(res.status).toBe(201);
    expect(res.body.emailed).toBe(false);
    expect(vi.mocked(sendSupportEmail)).toHaveBeenCalledOnce();
    const rows = await db.select().from(supportRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('open');
  });

  it('rejects short messages', async () => {
    const res = await request(app).post('/api/support').send({ ...ticket, message: 'hi' });
    expect(res.status).toBe(400);
  });
});

describe('admin auth', () => {
  const SECRET = 'test-admin-secret-0123456789abcdef0123456789ab';

  it('rejects a wrong secret', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ secret: 'wrong-secret-wrong-secret-wrong-secret-wrong' });
    expect(res.status).toBe(401);
  });

  it('issues access token + refresh cookie for the right secret', async () => {
    const res = await request(app).post('/api/admin/login').send({ secret: SECRET });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    const cookies = res.get('Set-Cookie') ?? [];
    expect(cookies.some((c) => c.startsWith('zf_admin_refresh=') && c.includes('HttpOnly'))).toBe(
      true,
    );
  });

  it('rotates the refresh token and revokes the family on reuse', async () => {
    // Capture the first refresh cookie, then rotate it.
    const login = await request(app).post('/api/admin/login').send({ secret: SECRET });
    const firstCookie = (login.get('Set-Cookie') ?? []).find((c) =>
      c.startsWith('zf_admin_refresh='),
    )!;

    const rotate1 = await request(app).post('/api/admin/refresh').set('Cookie', firstCookie);
    expect(rotate1.status).toBe(200);
    const secondCookie = (rotate1.get('Set-Cookie') ?? []).find((c) =>
      c.startsWith('zf_admin_refresh='),
    )!;

    // Reusing the FIRST (already-rotated) token is theft → 401 …
    const reuse = await request(app).post('/api/admin/refresh').set('Cookie', firstCookie);
    expect(reuse.status).toBe(401);

    // … and the whole family is revoked, so the SECOND token dies too.
    const rotate2 = await request(app).post('/api/admin/refresh').set('Cookie', secondCookie);
    expect(rotate2.status).toBe(401);
  });

  it('rate-limits login after 5 attempts', async () => {
    const wrong = { secret: 'wrong-secret-wrong-secret-wrong-secret-wrong' };
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/admin/login').send(wrong);
      expect(res.status).toBe(401);
    }
    const sixth = await request(app).post('/api/admin/login').send(wrong);
    expect(sixth.status).toBe(429);
  });

  it('guards admin routes', async () => {
    const anon = await request(app).get('/api/admin/metrics');
    expect(anon.status).toBe(401);

    const bad = await request(app)
      .get('/api/admin/metrics')
      .set('Authorization', 'Bearer not-a-token');
    expect(bad.status).toBe(401);
  });
});

describe('admin data routes', () => {
  const SECRET = 'test-admin-secret-0123456789abcdef0123456789ab';

  async function accessToken(): Promise<string> {
    const res = await request(app).post('/api/admin/login').send({ secret: SECRET });
    return res.body.accessToken as string;
  }

  it('returns metrics', async () => {
    await request(app).post('/api/waitlist').send({ email: 'a@example.com' });
    const token = await accessToken();
    const res = await request(app)
      .get('/api/admin/metrics')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.waitlist.total).toBe(1);
    expect(res.body.support.total).toBe(0);
  });

  it('paginates the waitlist and exports CSV', async () => {
    await request(app).post('/api/waitlist').send({ email: 'a@example.com', source: 'reddit' });
    await request(app).post('/api/waitlist').send({ email: 'b@example.com' });
    const token = await accessToken();

    const page = await request(app)
      .get('/api/admin/waitlist?page=1&pageSize=1')
      .set('Authorization', `Bearer ${token}`);
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(2);
    expect(page.body.items).toHaveLength(1);

    const csv = await request(app)
      .get('/api/admin/waitlist?format=csv')
      .set('Authorization', `Bearer ${token}`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('a@example.com');
    expect(csv.text).toContain('reddit');
  });

  it('lists and resolves support tickets', async () => {
    await request(app)
      .post('/api/support')
      .send({ name: 'Nick', email: 'n@example.com', message: 'Please help with my account.' });
    const token = await accessToken();

    const list = await request(app)
      .get('/api/admin/support')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    const id = list.body.items[0].id as number;

    const patch = await request(app)
      .patch(`/api/admin/support/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'resolved' });
    expect(patch.status).toBe(200);

    const after = await request(app)
      .get('/api/admin/support')
      .set('Authorization', `Bearer ${token}`);
    expect(after.body.items[0].status).toBe('resolved');
  });

  it('404s on resolving a missing ticket', async () => {
    const token = await accessToken();
    const res = await request(app)
      .patch('/api/admin/support/99999')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'resolved' });
    expect(res.status).toBe(404);
  });
});
