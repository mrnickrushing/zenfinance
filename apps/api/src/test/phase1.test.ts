import type { Express } from 'express';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { items, transactions } from '../db/schema.js';
import { decryptField, decryptToken, encryptField, encryptToken } from '../lib/crypto.js';
import type { TransactionProvider } from '../providers/types.js';
import { syncItem } from '../sync/engine.js';
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

const CREDS = { email: 'nick@example.com', password: 'a-strong-password' };

async function registerAndAuth(): Promise<{ access: string; refresh: string }> {
  const res = await request(app).post('/api/auth/register').send(CREDS);
  expect(res.status).toBe(201);
  return { access: res.body.accessToken, refresh: res.body.refreshToken };
}

async function linkBank(access: string): Promise<{ itemId: number; providerItemId: string }> {
  const tokenRes = await request(app)
    .post('/api/link/token')
    .set('Authorization', `Bearer ${access}`);
  expect(tokenRes.status).toBe(200);
  expect(tokenRes.body.linkToken).toBeTruthy();

  const exchange = await request(app)
    .post('/api/link/exchange')
    .set('Authorization', `Bearer ${access}`)
    .send({ publicToken: 'mock-public-token', institutionName: 'Mock Bank' });
  expect(exchange.status).toBe(201);
  return {
    itemId: exchange.body.id as number,
    providerItemId: 'ignored',
  };
}

describe('token encryption', () => {
  it('round-trips and never stores plaintext', () => {
    const stored = encryptToken('access-sandbox-secret');
    expect(stored).not.toContain('access-sandbox-secret');
    expect(decryptToken(stored)).toBe('access-sandbox-secret');
  });
});

describe('field encryption', () => {
  it('round-trips and never stores plaintext', () => {
    const stored = encryptField('Whole Foods Market');
    expect(stored).not.toContain('Whole Foods Market');
    expect(decryptField(stored)).toBe('Whole Foods Market');
  });

  it('passes plaintext through unchanged, for rows written before field encryption existed', () => {
    expect(decryptField('Whole Foods Market')).toBe('Whole Foods Market');
  });

  it('encrypts Plaid-sourced account and transaction text at rest, decrypted transparently on read', async () => {
    const { access } = await registerAndAuth();
    const link = await linkBank(access);

    const rawAccounts = (
      await db.execute(sql`select name, official_name, mask from accounts where item_id = ${link.itemId}`)
    ).rows as Array<{ name: string; official_name: string; mask: string }>;
    expect(rawAccounts.length).toBeGreaterThan(0);
    for (const row of rawAccounts) {
      expect(row.name).toMatch(/^v1:/);
      expect(row.official_name).toMatch(/^v1:/);
      expect(row.mask).toMatch(/^v1:/);
    }

    const rawTransactions = (
      await db.execute(
        sql`select t.name, t.merchant_name from transactions t join accounts a on a.id = t.account_id where a.item_id = ${link.itemId} limit 5`,
      )
    ).rows as Array<{ name: string; merchant_name: string | null }>;
    expect(rawTransactions.length).toBeGreaterThan(0);
    for (const row of rawTransactions) {
      expect(row.name).toMatch(/^v1:/);
      if (row.merchant_name) expect(row.merchant_name).toMatch(/^v1:/);
    }

    // The ORM and every API response still see plaintext — the mock
    // provider's deterministic account name/mask from providers/mock.ts.
    const itemsRes = await request(app).get('/api/items').set('Authorization', `Bearer ${access}`);
    expect(itemsRes.status).toBe(200);
    const checking = itemsRes.body.items[0].accounts.find((a: { mask: string }) => a.mask === '4321');
    expect(checking.name).toBe('Everyday Checking');
  });
});

describe('user auth', () => {
  it('returns the signed-in account profile', async () => {
    const { access } = await registerAndAuth();
    const profile = await request(app).get('/api/me').set('Authorization', `Bearer ${access}`);

    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({ email: CREDS.email, signInMethods: ['password'] });
    expect(new Date(profile.body.createdAt).toString()).not.toBe('Invalid Date');
  });

  it('registers, rejects duplicates without enumeration', async () => {
    await registerAndAuth();
    const dup = await request(app).post('/api/auth/register').send(CREDS);
    expect(dup.status).toBe(400);
  });

  it('logs in with correct password only', async () => {
    await registerAndAuth();
    const bad = await request(app)
      .post('/api/auth/login')
      .send({ ...CREDS, password: 'wrong-password-1' });
    expect(bad.status).toBe(401);
    const good = await request(app).post('/api/auth/login').send(CREDS);
    expect(good.status).toBe(200);
    expect(good.body.accessToken).toBeTruthy();
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const { refresh } = await registerAndAuth();
    const r1 = await request(app).post('/api/auth/refresh').send({ refreshToken: refresh });
    expect(r1.status).toBe(200);

    const reuse = await request(app).post('/api/auth/refresh').send({ refreshToken: refresh });
    expect(reuse.status).toBe(401);

    // Family revoked → the rotated token is dead too.
    const r2 = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: r1.body.refreshToken });
    expect(r2.status).toBe(401);
  });

  it('guards user routes', async () => {
    const res = await request(app).get('/api/items');
    expect(res.status).toBe(401);
  });
});

describe('linking + backfill (mock provider, inline queue)', () => {
  it('flags an empty initial Plaid cursor so the queue can retry the backfill', async () => {
    const { access } = await registerAndAuth();
    const { itemId } = await linkBank(access);
    const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
    await db.delete(transactions);
    await db.update(items).set({ syncCursor: null, lastSyncedAt: null }).where(eq(items.id, itemId));

    const pendingProvider = {
      name: 'pending-test',
      fetchAccounts: async () => [],
      syncTransactions: async () => ({
        added: [],
        modified: [],
        removedProviderTxnIds: [],
        nextCursor: '',
        hasMore: false,
      }),
    } as unknown as TransactionProvider;

    await expect(syncItem(db, pendingProvider, itemId)).resolves.toEqual({
      userId: item!.userId,
      initialDataPending: true,
    });
  });

  it('exchanges a public token, stores accounts, and backfills 90 days', async () => {
    const { access } = await registerAndAuth();
    await linkBank(access);

    const itemsRes = await request(app).get('/api/items').set('Authorization', `Bearer ${access}`);
    expect(itemsRes.status).toBe(200);
    expect(itemsRes.body.items).toHaveLength(1);
    expect(itemsRes.body.items[0].accounts).toHaveLength(2);
    expect(itemsRes.body.items[0].lastSyncedAt).toBeTruthy();

    const txns = await request(app)
      .get('/api/transactions?pageSize=200')
      .set('Authorization', `Bearer ${access}`);
    expect(txns.status).toBe(200);
    expect(txns.body.total).toBeGreaterThan(30); // ~30 spends + 6 payroll + transfers + pending
    const dates = txns.body.items.map((t: { postedDate: string }) => t.postedDate);
    const oldest = dates.sort()[0]!;
    expect(Date.now() - Date.parse(oldest)).toBeGreaterThan(80 * 86400000);
  });

  it('marks own-account transfer pairs so they never count as spending', async () => {
    const { access } = await registerAndAuth();
    await linkBank(access);
    const txns = await request(app)
      .get('/api/transactions?pageSize=200')
      .set('Authorization', `Bearer ${access}`);
    const paired = txns.body.items.filter(
      (t: { transferPairId: string | null }) => t.transferPairId,
    );
    expect(paired).toHaveLength(2);
    expect(paired[0].transferPairId).toBe(paired[1].transferPairId);
    const amounts = paired.map((t: { amountCents: number }) => t.amountCents).sort((a: number, b: number) => a - b);
    expect(amounts).toEqual([-50000, 50000]);
  });

  it('reconciles pending→posted and honors provider removals on webhook sync', async () => {
    const { access } = await registerAndAuth();
    await linkBank(access);

    const before = await request(app)
      .get('/api/transactions?pageSize=200')
      .set('Authorization', `Bearer ${access}`);
    const pendingBefore = before.body.items.find((t: { name: string }) =>
      t.name.includes('PENDING'),
    );
    expect(pendingBefore).toBeTruthy();
    const totalBefore = before.body.total as number;

    // Drive the webhook exactly as Plaid would, using the stored item id.
    const { pool } = await import('../db/client.js');
    const { rows } = await pool.query('SELECT provider_item_id FROM items LIMIT 1');
    const providerItemId = rows[0].provider_item_id as string;

    const hook = await request(app).post('/api/webhooks/plaid').send({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: providerItemId,
    });
    expect(hook.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100)); // webhook enqueues after responding

    const after = await request(app)
      .get('/api/transactions?pageSize=200')
      .set('Authorization', `Bearer ${access}`);
    // +1 posted coffee, -1 superseded pending, -1 provider-removed artifact
    expect(after.body.total).toBe(totalBefore - 1);
    const names = after.body.items.map((t: { name: string }) => t.name);
    expect(names).toContain('BLUE BOTTLE COFFEE');
    expect(names.filter((n: string) => n.includes('PENDING'))).toHaveLength(0);

    // History preserved: superseded + removed rows still exist in the table.
    const all = await db.select().from(transactions);
    expect(all.some((t) => t.supersededAt !== null)).toBe(true);
    expect(all.some((t) => t.removedAt !== null)).toBe(true);
  });

  it('re-syncing is idempotent (dedupe on provider txn id)', async () => {
    const { access } = await registerAndAuth();
    await linkBank(access);
    const first = await request(app)
      .get('/api/transactions?pageSize=200')
      .set('Authorization', `Bearer ${access}`);

    const { pool } = await import('../db/client.js');
    const { rows } = await pool.query('SELECT provider_item_id FROM items LIMIT 1');
    // Two webhook syncs: generation 1 (mutations) then generation 2 (empty page).
    for (let i = 0; i < 2; i++) {
      await request(app).post('/api/webhooks/plaid').send({
        webhook_type: 'TRANSACTIONS',
        webhook_code: 'SYNC_UPDATES_AVAILABLE',
        item_id: rows[0].provider_item_id,
      });
      await new Promise((r) => setTimeout(r, 100));
    }
    const second = await request(app)
      .get('/api/transactions?pageSize=200')
      .set('Authorization', `Bearer ${access}`);
    expect(second.body.total).toBe((first.body.total as number) - 1); // stable after mutations settle
  });
});

describe('deletion rights', () => {
  it('disconnecting an item wipes its accounts and transactions', async () => {
    const { access } = await registerAndAuth();
    const { itemId } = await linkBank(access);

    const del = await request(app)
      .delete(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${access}`);
    expect(del.status).toBe(200);

    const itemsRes = await request(app).get('/api/items').set('Authorization', `Bearer ${access}`);
    expect(itemsRes.body.items).toHaveLength(0);
    const txns = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${access}`);
    expect(txns.body.total).toBe(0);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  it("cannot disconnect another user's item", async () => {
    const { access } = await registerAndAuth();
    const { itemId } = await linkBank(access);

    const other = await request(app)
      .post('/api/auth/register')
      .send({ email: 'mallory@example.com', password: 'another-strong-pw' });
    const del = await request(app)
      .delete(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${other.body.accessToken}`);
    expect(del.status).toBe(404);
  });

  it('DELETE /api/me purges the user and everything downstream', async () => {
    const { access } = await registerAndAuth();
    await linkBank(access);

    const del = await request(app).delete('/api/me').set('Authorization', `Bearer ${access}`);
    expect(del.status).toBe(200);

    const login = await request(app).post('/api/auth/login').send(CREDS);
    expect(login.status).toBe(401);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });
});
