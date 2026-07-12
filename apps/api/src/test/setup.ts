import { execSync } from 'node:child_process';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { adminRefreshTokens, supportRequests, waitlistSignups } from '../db/schema.js';

let migrated = false;

/** Apply migrations once per test run, against the test database. */
export async function migrateOnce(): Promise<void> {
  if (migrated) return;
  execSync('npx drizzle-kit migrate', {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'pipe',
  });
  migrated = true;
}

export async function truncateAll(): Promise<void> {
  await db.delete(adminRefreshTokens);
  await db.delete(supportRequests);
  await db.delete(waitlistSignups);
  await db.execute(sql`SELECT 1`);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
