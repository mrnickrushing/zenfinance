import crypto from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { db } from '../db/client.js';
import { passwordResetCodes, users } from '../db/schema.js';
import { sentEmails } from '../lib/email.js';
import { closeDb, migrateOnce, truncateAll } from './setup.js';

let app: Express;
const EMAIL = 'reset-me@example.com';
const OLD_PASSWORD = 'old-password-123';
const NEW_PASSWORD = 'brand-new-password-9';

beforeAll(async () => {
  await migrateOnce();
});

beforeEach(async () => {
  await truncateAll();
  sentEmails.length = 0;
  app = createApp();
});

afterAll(async () => {
  await closeDb();
});

async function register(email = EMAIL, password = OLD_PASSWORD) {
  const res = await request(app).post('/api/auth/register').send({ email, password });
  expect(res.status).toBe(201);
  return res.body as { accessToken: string; refreshToken: string };
}

function codeFromLastEmail(): string {
  const last = sentEmails.at(-1);
  expect(last).toBeTruthy();
  const match = /\b(\d{6})\b/.exec(last!.text);
  expect(match).toBeTruthy();
  return match![1]!;
}

describe('password reset', () => {
  it('emails a code, resets the password, and revokes existing sessions', async () => {
    const { refreshToken } = await register();

    const forgot = await request(app).post('/api/auth/forgot').send({ email: EMAIL });
    expect(forgot.status).toBe(200);
    const code = codeFromLastEmail();

    const reset = await request(app).post('/api/auth/reset').send({ email: EMAIL, code, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);

    // Old refresh token was revoked by the reset.
    const refresh = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(refresh.status).toBe(401);

    // New password works.
    const login = await request(app).post('/api/auth/login').send({ email: EMAIL, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTruthy();
  });

  it('rejects a wrong code without changing the password', async () => {
    await register();
    await request(app).post('/api/auth/forgot').send({ email: EMAIL });

    const reset = await request(app).post('/api/auth/reset').send({ email: EMAIL, code: '000000', password: NEW_PASSWORD });
    expect(reset.status).toBe(400);

    const login = await request(app).post('/api/auth/login').send({ email: EMAIL, password: OLD_PASSWORD });
    expect(login.status).toBe(200); // old password still valid
  });

  it('rejects an expired code', async () => {
    const user = await db.insert(users).values({ email: EMAIL, passwordHash: 'x' }).returning({ id: users.id });
    await db.insert(passwordResetCodes).values({
      userId: user[0]!.id,
      codeHash: crypto.createHash('sha256').update('123456').digest('hex'),
      expiresAt: new Date(Date.now() - 60_000), // already expired
    });
    const reset = await request(app).post('/api/auth/reset').send({ email: EMAIL, code: '123456', password: NEW_PASSWORD });
    expect(reset.status).toBe(400);
  });

  it('does not reveal whether an email exists (still 200, no mail sent)', async () => {
    const res = await request(app).post('/api/auth/forgot').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(sentEmails).toHaveLength(0);
  });
});
