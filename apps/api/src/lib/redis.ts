import { Redis } from 'ioredis';
import { env } from '../env.js';
import { safeErrorSummary } from './safeError.js';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
    });
    redisClient.on('error', (err) => {
      console.error('[redis] connection error:', safeErrorSummary(err));
    });
  }
  return redisClient;
}

export async function redisIsReady(timeoutMs = 1_000): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return env.NODE_ENV !== 'production';

  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      client.ping().then((reply) => reply === 'PONG'),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } catch (err) {
    console.error('[redis] readiness check failed:', safeErrorSummary(err));
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
