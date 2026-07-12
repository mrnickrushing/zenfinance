import { db } from '../db/client.js';
import { env } from '../env.js';
import { getProvider } from '../providers/index.js';
import { syncItem } from '../sync/engine.js';

export const SYNC_QUEUE = 'item-sync';

// Job-queue-first design: with REDIS_URL set, sync jobs run on a BullMQ
// worker; without it (local dev, tests), enqueue degrades to inline
// execution so the flow stays fully functional and deterministic.

let bullQueue: import('bullmq').Queue | null = null;

async function getBullQueue(): Promise<import('bullmq').Queue> {
  if (!bullQueue) {
    const { Queue } = await import('bullmq');
    bullQueue = new Queue(SYNC_QUEUE, {
      connection: { url: env.REDIS_URL! },
    });
  }
  return bullQueue;
}

export async function enqueueItemSync(itemId: number): Promise<void> {
  if (env.REDIS_URL) {
    const queue = await getBullQueue();
    // Deduplicate bursts of webhooks for the same item.
    await queue.add('sync', { itemId }, { jobId: `item-${itemId}-${Date.now() >> 13}` });
    return;
  }
  await syncItem(db, getProvider(), itemId);
}

/** Start the BullMQ worker (production path). No-op without REDIS_URL. */
export async function startSyncWorker(): Promise<void> {
  if (!env.REDIS_URL) return;
  const { Worker } = await import('bullmq');
  new Worker<{ itemId: number }>(
    SYNC_QUEUE,
    async (job) => {
      await syncItem(db, getProvider(), job.data.itemId);
    },
    { connection: { url: env.REDIS_URL }, concurrency: 5 },
  );
}
