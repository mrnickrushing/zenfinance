import { sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client.js';

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

  return healthRouter;
}
