import { sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client.js';
import { env } from '../env.js';

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
      redisConfigured: env.NODE_ENV !== 'production' || Boolean(env.REDIS_URL),
    };
    try {
      await db.execute(sql`SELECT 1`);
      checks.db = true;
    } catch {
      checks.db = false;
    }
    const ok = Object.values(checks).every(Boolean);
    res.status(ok ? 200 : 503).json({ ok, checks });
  });

  return healthRouter;
}
