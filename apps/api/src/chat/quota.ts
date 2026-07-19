import { getRedisClient } from '../lib/redis.js';
import { safeErrorSummary } from '../lib/safeError.js';

/** Anthropic-backed replies allowed per user per calendar month before falling back to the free deterministic answer. */
export const CHAT_AI_MONTHLY_LIMIT = 150;

const monthlyBuckets = new Map<string, { count: number; resetAt: number }>();

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function nextMonthBoundary(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

/**
 * Consumes one unit of a user's monthly AI-chat quota and reports whether they were
 * still within budget. Callers should skip the paid LLM call (and keep the free
 * deterministic answer) when this returns false, rather than surfacing an error.
 */
export async function consumeAiChatQuota(userId: number): Promise<boolean> {
  const key = `zenfinance:ai-quota:chat:${userId}:${currentMonthKey()}`;
  const redis = getRedisClient();
  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, 32 * 24 * 60 * 60);
      }
      return count <= CHAT_AI_MONTHLY_LIMIT;
    } catch (err) {
      console.error('[chat] Redis unavailable for AI quota check; using local fallback:', safeErrorSummary(err));
    }
  }

  const now = Date.now();
  for (const [bucketKey, bucket] of monthlyBuckets) {
    if (bucket.resetAt <= now) monthlyBuckets.delete(bucketKey);
  }
  const current = monthlyBuckets.get(key);
  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: nextMonthBoundary() };
  bucket.count += 1;
  monthlyBuckets.set(key, bucket);
  return bucket.count <= CHAT_AI_MONTHLY_LIMIT;
}
