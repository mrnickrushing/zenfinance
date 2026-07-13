import * as Sentry from '@sentry/node';
import { createApp } from './app.js';
import { env } from './env.js';
import {
  scheduleNightlyRollupJob,
  scheduleWeeklyBriefJob,
  startEnrichWorker,
  startFeatureWorker,
  startFirstLookWorker,
  startSyncWorker,
  startWeeklyBriefWorker,
} from './queue/index.js';
import { db } from './db/client.js';
import { processPendingProviderRevocations } from './privacy/service.js';
import { safeErrorSummary } from './lib/safeError.js';

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.2 : 1.0,
    sendDefaultPii: false,
    beforeSend(event) {
      const scrub = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(scrub);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
            if (/email|password|token|secret|authorization|cookie|plaid|revenuecat/i.test(key)) {
              return [key, '[Filtered]'];
            }
            return [key, scrub(entry)];
          }),
        );
      };
      return scrub(event) as typeof event;
    },
  });
}

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`[api] listening on :${env.PORT} (${env.NODE_ENV})`);
});

void startSyncWorker().then(() => {
  if (env.REDIS_URL) console.log('[api] sync worker started (BullMQ)');
});
void startEnrichWorker().then(() => {
  if (env.REDIS_URL) console.log('[api] enrichment worker started (BullMQ)');
});
void startFeatureWorker().then(() => {
  if (env.REDIS_URL) console.log('[api] feature-rollup worker started (BullMQ)');
});
void startFirstLookWorker().then(() => {
  if (env.REDIS_URL) console.log('[api] first-look worker started (BullMQ)');
});
void startWeeklyBriefWorker().then(() => {
  if (env.REDIS_URL) console.log('[api] weekly-brief worker started (BullMQ)');
});
void scheduleNightlyRollupJob();
void scheduleWeeklyBriefJob();

// Processor revocation retries are deliberately database-backed so a deploy
// or Redis interruption cannot lose the only credential capable of revoking
// a user's Plaid item.
let revocationSweepRunning = false;
async function runRevocationSweep(): Promise<void> {
  if (revocationSweepRunning) return;
  revocationSweepRunning = true;
  try {
    await processPendingProviderRevocations(db);
  } catch (err) {
    console.error('[privacy] provider revocation sweep failed:', safeErrorSummary(err));
    Sentry.captureException(err);
  } finally {
    revocationSweepRunning = false;
  }
}
void runRevocationSweep();
setInterval(() => void runRevocationSweep(), 60_000).unref();
