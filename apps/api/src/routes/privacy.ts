import { Router } from 'express';
import { db } from '../db/client.js';
import { buildUserDataExport } from '../privacy/service.js';
import { requireUser } from '../middleware/userAuth.js';

export function createPrivacyRouter(): ReturnType<typeof Router> {
  const router = Router();

  router.get('/api/me/export', requireUser, async (_req, res) => {
    const exportView = await buildUserDataExport(db, res.locals.userId as number);
    if (!exportView) {
      res.status(404).json({ error: { code: 'not_found', message: 'User not found' } });
      return;
    }
    res.json(exportView);
  });

  return router;
}
