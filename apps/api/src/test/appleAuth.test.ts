import type { Express } from 'express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { closeDb, migrateOnce, truncateAll } from './setup.js';

// The real verifier hits Apple's JWKS endpoint; stub it so the route's
// find-or-create + token-issuance logic is what's under test. `vi.hoisted`
// lets each case swap the identity (or force a verification failure).
const appleState = vi.hoisted(() => ({
  result: null as { sub: string; email?: string; emailVerified?: boolean } | Error | null,
}));

vi.mock('../lib/apple.js', () => ({
  verifyAppleIdentityToken: async () => {
    if (appleState.result instanceof Error) throw appleState.result;
    if (!appleState.result) throw new Error('no identity configured');
    return appleState.result;
  },
}));

let app: Express;

beforeAll(async () => {
  await migrateOnce();
});

beforeEach(async () => {
  await truncateAll();
  app = createApp();
  appleState.result = null;
});

afterAll(async () => {
  await closeDb();
});

function apple(body: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/auth/apple')
    .send({ identityToken: 'stub-token', rawNonce: 'raw-nonce-value', ...body });
}

describe('POST /api/auth/apple', () => {
  it('creates a new user on first sign-in with a verified email', async () => {
    appleState.result = { sub: 'apple-sub-1', email: 'first@example.com', emailVerified: true };
    const res = await apple();
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();

    const [row] = await db.select().from(users).where(eq(users.appleSub, 'apple-sub-1')).limit(1);
    expect(row?.email).toBe('first@example.com');
    expect(row?.passwordHash ?? null).toBeNull();
  });

  it('returns the same account (200) on a repeat sign-in by apple subject', async () => {
    appleState.result = { sub: 'apple-sub-2', email: 'repeat@example.com', emailVerified: true };
    const created = await apple();
    expect(created.status).toBe(201);

    // Apple omits the email on subsequent sign-ins — the subject alone resolves it.
    appleState.result = { sub: 'apple-sub-2' };
    const again = await apple();
    expect(again.status).toBe(200);
    expect(again.body.accessToken).toBeTruthy();

    const rows = await db.select().from(users).where(eq(users.appleSub, 'apple-sub-2'));
    expect(rows).toHaveLength(1);
  });

  it('links an Apple subject to an existing email/password account', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'link@example.com', password: 'a-strong-password' });
    expect(reg.status).toBe(201);

    appleState.result = { sub: 'apple-sub-3', email: 'link@example.com', emailVerified: true };
    const linked = await apple();
    expect(linked.status).toBe(200);

    const rows = await db.select().from(users).where(eq(users.email, 'link@example.com'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.appleSub).toBe('apple-sub-3');
  });

  it('rejects a first sign-in with no verified email (400)', async () => {
    appleState.result = { sub: 'apple-sub-4', emailVerified: false };
    const res = await apple();
    expect(res.status).toBe(400);
    const [row] = await db.select().from(users).where(eq(users.appleSub, 'apple-sub-4')).limit(1);
    expect(row).toBeUndefined();
  });

  it('rejects an invalid identity token (401)', async () => {
    appleState.result = new Error('nonce mismatch');
    const res = await apple();
    expect(res.status).toBe(401);
  });
});
