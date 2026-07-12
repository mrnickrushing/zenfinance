import { execSync } from 'node:child_process';
import { sql } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import {
  adminRefreshTokens,
  appEvents,
  billingCustomers,
  billingEntitlements,
  billingEvents,
  privacyDeletionEvents,
  pricingExperiments,
  referralCodes,
  referralCredits,
  referralRedemptions,
  supportRequests,
  users,
  waitlistSignups,
} from '../db/schema.js';

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
  await db.delete(referralCredits);
  await db.delete(referralRedemptions);
  await db.delete(referralCodes);
  await db.delete(billingEvents);
  await db.delete(appEvents);
  await db.delete(billingEntitlements);
  await db.delete(pricingExperiments);
  await db.delete(billingCustomers);
  await db.delete(privacyDeletionEvents);
  await db.delete(supportRequests);
  await db.delete(waitlistSignups);
  await db.delete(users); // cascades refresh tokens, items, accounts, transactions
  await db.execute(sql`SELECT 1`);
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
