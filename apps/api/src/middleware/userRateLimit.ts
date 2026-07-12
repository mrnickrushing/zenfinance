import type { NextFunction, Request, Response } from 'express';

interface UserRateLimitOptions {
  windowMs: number;
  limit: number;
  message: string;
}

const buckets = new Map<string, { count: number; resetAt: number }>();

export function userRateLimit(name: string, options: UserRateLimitOptions) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const userId = res.locals.userId as number | undefined;
    const key = `${name}:${userId ?? 'anonymous'}`;
    const now = Date.now();
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
