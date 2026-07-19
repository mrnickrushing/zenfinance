import { Router, type NextFunction, type Response } from 'express';
import { db } from '../db/client.js';
import { userRateLimit } from '../middleware/userRateLimit.js';
import { requireUser } from '../middleware/userAuth.js';
import { streamUserDataExport } from '../privacy/service.js';

async function writeChunk(res: Response, chunk: string): Promise<void> {
  if (res.destroyed || res.writableEnded) throw new Error('Privacy export connection closed');
  if (res.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      res.off('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Privacy export connection closed'));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    res.once('drain', onDrain);
    res.once('close', onClose);
    res.once('error', onError);
  });
}

export function createPrivacyRouter(): ReturnType<typeof Router> {
  const router = Router();

  router.get(
    '/api/me/export',
    requireUser,
    userRateLimit('privacy-export', {
      windowMs: 60 * 60_000,
      limit: 2,
      message: 'Data exports are limited to two per hour. Try again later.',
    }),
    async (_req, res, next: NextFunction) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="zenfinance-data-export.json"');
      try {
        const found = await streamUserDataExport(db, res.locals.userId as number, (chunk) => writeChunk(res, chunk));
        if (!found) {
          res.removeHeader('Content-Disposition');
          res.status(404).json({ error: { code: 'not_found', message: 'User not found' } });
          return;
        }
        res.end();
      } catch (error) {
        if (res.destroyed || res.writableEnded) return;
        if (!res.headersSent) {
          res.removeHeader('Content-Disposition');
          next(error);
          return;
        }
        res.destroy(error instanceof Error ? error : new Error('Privacy export failed'));
      }
    },
  );

  return router;
}
