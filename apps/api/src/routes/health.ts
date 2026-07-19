import { sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client.js';
import { redisIsReady } from '../lib/redis.js';

export function createHealthRouter(): ReturnType<typeof Router> {
  const healthRouter = Router();

  // Health check verifies the database, not just process liveness.
  healthRouter.get('/health', async (_req, res) => {
    try {
      await db.execute(sql`SELECT 1`);
      res.json({ ok: true, db: 'up' });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  healthRouter.get('/ready', async (_req, res) => {
    const checks: Record<string, boolean> = {
      db: false,
      redis: false,
    };
    const [dbReady, redisReady] = await Promise.all([
      db.execute(sql`SELECT 1`).then(() => true).catch(() => false),
      redisIsReady(),
    ]);
    checks.db = dbReady;
    checks.redis = redisReady;
    const ok = Object.values(checks).every(Boolean);
    res.status(ok ? 200 : 503).json({ ok, checks });
  });

  return healthRouter;
}
