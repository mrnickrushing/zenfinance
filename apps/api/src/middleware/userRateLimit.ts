import type { NextFunction, Request, Response } from 'express';
import { Redis } from 'ioredis';
import { env } from '../env.js';

interface UserRateLimitOptions {
  windowMs: number;
  limit: number;
  message: string;
}

const buckets = new Map<string, { count: number; resetAt: number }>();
let redisPromise: Promise<Redis> | null = null;

async function redisClient(): Promise<Redis | null> {
  if (!env.REDIS_URL) return null;
  redisPromise ??= Promise.resolve(new Redis(env.REDIS_URL!, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  }));
  return redisPromise;
}

export function userRateLimit(name: string, options: UserRateLimitOptions) {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = res.locals.userId as number | undefined;
    const key = `${name}:${userId ?? 'anonymous'}`;
    const now = Date.now();
    const redis = await redisClient();
    if (redis) {
      try {
        const redisKey = `zenfinance:rate-limit:${key}`;
        const result = await redis
          .multi()
          .incr(redisKey)
          .pttl(redisKey)
          .exec();
        const count = Number(result?.[0]?.[1] ?? 1);
        let ttl = Number(result?.[1]?.[1] ?? -1);
        if (ttl < 0) {
          await redis.pexpire(redisKey, options.windowMs);
          ttl = options.windowMs;
        }
        if (count > options.limit) {
          res.status(429).setHeader('Retry-After', String(Math.ceil(ttl / 1000))).json({
            error: { code: 'rate_limited', message: options.message },
          });
          return;
        }
        next();
        return;
      } catch (err) {
        // Preserve availability if Redis is briefly unavailable. The bounded
        // process-local limiter below still provides per-instance protection.
        console.error('[rate-limit] Redis unavailable; using local fallback:', err);
      }
    }

    // Test/development fallback. Expire stale entries on every request so the
    // process-local map cannot grow without bound.
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
    const current = buckets.get(key);
    const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + options.windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > options.limit) {
      res
        .status(429)
        .setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)))
        .json({ error: { code: 'rate_limited', message: options.message } });
      return;
    }

    next();
  };
}
