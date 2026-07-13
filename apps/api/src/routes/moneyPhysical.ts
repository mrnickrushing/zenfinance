import { moneyPhysicalRestoreSchema, type MoneyPhysicalRestoreInput } from '@zenfinance/shared';
import { Router } from 'express';
import { getOrCreateBillingCustomer } from '../billing/service.js';
import { db } from '../db/client.js';
import { env } from '../env.js';
import {
  getMoneyPhysicalStatus,
  recordMoneyPhysicalPurchase,
  validateMoneyPhysicalRevenueCatPurchase,
} from '../moneyPhysical/service.js';
import { requireUser } from '../middleware/userAuth.js';
import { userRateLimit } from '../middleware/userRateLimit.js';
import { validateBody } from '../middleware/validate.js';

export function createMoneyPhysicalRouter(): ReturnType<typeof Router> {
  const router = Router();

  router.get('/api/money-physical/status', requireUser, async (_req, res) => {
    const userId = res.locals.userId as number;
    res.json(await getMoneyPhysicalStatus(db, userId));
  });

  router.post('/api/money-physical/restore', requireUser, userRateLimit('money-physical-restore', {
    windowMs: 15 * 60 * 1000,
    limit: 6,
    message: 'Too many restore attempts. Try again later.',
  }), validateBody(moneyPhysicalRestoreSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    const input = res.locals.body as MoneyPhysicalRestoreInput;
    const appUserId = await getOrCreateBillingCustomer(db, userId);
    if (input.appUserId !== appUserId) {
      res.status(400).json({ error: { code: 'money_physical_restore_failed', message: 'RevenueCat appUserId does not match authenticated user' } });
      return;
    }
    if (env.NODE_ENV === 'production' && !env.REVENUECAT_SECRET_API_KEY) {
      res.status(503).json({
        error: {
          code: 'money_physical_restore_unavailable',
          message: 'REVENUECAT_SECRET_API_KEY is required to validate Money Physical restores in production',
        },
      });
      return;
    }

    try {
      const validated = env.REVENUECAT_SECRET_API_KEY
        ? await validateMoneyPhysicalRevenueCatPurchase(input.appUserId, input.transactionId)
        : null;
      if (env.REVENUECAT_SECRET_API_KEY && !validated) {
        res.status(400).json({
          error: {
            code: 'money_physical_restore_failed',
            message: 'RevenueCat did not return a matching Money Physical purchase for this transaction',
          },
        });
        return;
      }
      const report = await recordMoneyPhysicalPurchase(db, userId, { ...input, ...(validated ?? {}) }, 'client_restore');
      res.status(201).json(report);
    } catch (err) {
      res.status(400).json({
        error: {
          code: 'money_physical_restore_failed',
          message: err instanceof Error ? err.message : 'Money Physical restore failed',
        },
      });
    }
  });

  return router;
}
