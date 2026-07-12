import { db } from '../db/client.js';
import { env } from '../env.js';
import { getEnrichmentProvider } from '../enrichment/index.js';
import { enrichUserTransactions } from '../enrichment/pipeline.js';
import { runNightlyRollupsForAllUsers } from '../features/rollup.js';
import { getProvider } from '../providers/index.js';
import { syncItem } from '../sync/engine.js';

export const SYNC_QUEUE = 'item-sync';
export const ENRICH_QUEUE = 'user-enrich';
export const FEATURE_QUEUE = 'feature-rollup-nightly';

// Job-queue-first design: with REDIS_URL set, jobs run on BullMQ workers;
// without it (local dev, tests), enqueue degrades to inline execution so the
// flow stays fully functional and deterministic.

let bullQueue: import('bullmq').Queue | null = null;
let enrichQueue: import('bullmq').Queue | null = null;
let featureQueue: import('bullmq').Queue | null = null;

async function getBullQueue(): Promise<import('bullmq').Queue> {
  if (!bullQueue) {
    const { Queue } = await import('bullmq');
    bullQueue = new Queue(SYNC_QUEUE, {
      connection: { url: env.REDIS_URL! },
    });
  }
  return bullQueue;
}

async function getEnrichQueue(): Promise<import('bullmq').Queue> {
  if (!enrichQueue) {
    const { Queue } = await import('bullmq');
    enrichQueue = new Queue(ENRICH_QUEUE, {
      connection: { url: env.REDIS_URL! },
    });
  }
  return enrichQueue;
}

async function getFeatureQueue(): Promise<import('bullmq').Queue> {
  if (!featureQueue) {
    const { Queue } = await import('bullmq');
    featureQueue = new Queue(FEATURE_QUEUE, {
      connection: { url: env.REDIS_URL! },
    });
  }
  return featureQueue;
}

export async function enqueueItemSync(itemId: number): Promise<void> {
  if (env.REDIS_URL) {
    const queue = await getBullQueue();
    // Deduplicate bursts of webhooks for the same item.
    await queue.add('sync', { itemId }, { jobId: `item-${itemId}-${Date.now() >> 13}` });
    return;
  }
  const result = await syncItem(db, getProvider(), itemId);
  if (result) await enqueueEnrichment(result.userId);
}

/** Start the BullMQ sync worker (production path). No-op without REDIS_URL. */
export async function startSyncWorker(): Promise<void> {
  if (!env.REDIS_URL) return;
  const { Worker } = await import('bullmq');
  new Worker<{ itemId: number }>(
    SYNC_QUEUE,
    async (job) => {
      const result = await syncItem(db, getProvider(), job.data.itemId);
      if (result) await enqueueEnrichment(result.userId);
    },
    { connection: { url: env.REDIS_URL }, concurrency: 5 },
  );
}

/** Queue (or run inline) a batch-enrichment pass for a user's new transactions. */
export async function enqueueEnrichment(userId: number): Promise<void> {
  if (env.REDIS_URL) {
    const queue = await getEnrichQueue();
    await queue.add('enrich', { userId }, { jobId: `enrich-${userId}-${Date.now() >> 13}` });
    return;
  }
  await enrichUserTransactions(db, getEnrichmentProvider(), userId);
}

/** Start the BullMQ enrichment worker (production path). No-op without REDIS_URL. */
export async function startEnrichWorker(): Promise<void> {
  if (!env.REDIS_URL) return;
  const { Worker } = await import('bullmq');
  new Worker<{ userId: number }>(
    ENRICH_QUEUE,
    async (job) => {
      await enrichUserTransactions(db, getEnrichmentProvider(), job.data.userId);
    },
    { connection: { url: env.REDIS_URL }, concurrency: 5 },
  );
}

/** Schedule the nightly feature-rollup job (production path). No-op without REDIS_URL. */
export async function scheduleNightlyRollupJob(): Promise<void> {
  if (!env.REDIS_URL) return;
  const queue = await getFeatureQueue();
  await queue.add(
    'nightly-rollup',
    {},
    { repeat: { pattern: '0 6 * * *' }, jobId: 'nightly-rollup' },
  );
}

/** Start the BullMQ feature-rollup worker (production path). No-op without REDIS_URL. */
export async function startFeatureWorker(): Promise<void> {
  if (!env.REDIS_URL) return;
  const { Worker } = await import('bullmq');
  new Worker(
    FEATURE_QUEUE,
    async () => {
      await runNightlyRollupsForAllUsers(db);
    },
    { connection: { url: env.REDIS_URL } },
  );
}
