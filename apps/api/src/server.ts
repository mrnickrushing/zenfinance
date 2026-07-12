import * as Sentry from '@sentry/node';
import { createApp } from './app.js';
import { env } from './env.js';
import { scheduleNightlyRollupJob, startEnrichWorker, startFeatureWorker, startSyncWorker } from './queue/index.js';

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.2 : 1.0,
    sendDefaultPii: false,
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
void scheduleNightlyRollupJob();
