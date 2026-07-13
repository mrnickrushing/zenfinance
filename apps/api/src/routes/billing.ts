import { billingRestoreSchema, appEventSchema, type AppEventInput, type BillingRestoreInput } from '@zenfinance/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  applyClientRestore,
  getBillingStatus,
  processRevenueCatWebhook,
  syncFromRevenueCatRest,
  verifyRevenueCatAuthorization,
  verifyRevenueCatSignature,
} from '../billing/service.js';
import { db } from '../db/client.js';
import { appEvents } from '../db/schema.js';
import { userRateLimit } from '../middleware/userRateLimit.js';
import { requireUser } from '../middleware/userAuth.js';
import { validateBody } from '../middleware/validate.js';

export function createBillingRouter(): ReturnType<typeof Router> {
  const router = Router();
  const revenueCatWebhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.get('/api/billing/status', requireUser, async (_req, res) => {
    const userId = res.locals.userId as number;
    res.json(await getBillingStatus(db, userId));
  });

  router.post('/api/billing/refresh', requireUser, userRateLimit('billing-refresh', {
    windowMs: 60 * 1000,
    limit: 6,
    message: 'Too many billing refreshes. Try again shortly.',
  }), async (_req, res) => {
    const userId = res.locals.userId as number;
    await syncFromRevenueCatRest(db, userId);
    res.json(await getBillingStatus(db, userId));
  });

  router.post('/api/billing/restore', requireUser, userRateLimit('billing-restore', {
    windowMs: 15 * 60 * 1000,
    limit: 6,
    message: 'Too many billing restore attempts. Try again later.',
  }), validateBody(billingRestoreSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    try {
      await applyClientRestore(db, userId, res.locals.body as BillingRestoreInput);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Restore failed';
      res.status(message.includes('required') ? 503 : 400).json({ error: { code: 'billing_restore_failed', message } });
      return;
    }
    res.json(await getBillingStatus(db, userId));
  });

  router.post('/api/billing/events', requireUser, userRateLimit('billing-events', {
    windowMs: 60 * 1000,
    limit: 60,
    message: 'Too many billing events.',
  }), validateBody(appEventSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    const input = res.locals.body as AppEventInput;
    await db.insert(appEvents).values({ userId, name: `billing:${input.name}`, properties: input.properties });
    res.status(201).json({ ok: true });
  });

  router.post('/api/webhooks/revenuecat', revenueCatWebhookLimiter, async (req, res) => {
    const rawBody = Buffer.isBuffer((req as { rawBody?: unknown }).rawBody)
      ? ((req as unknown as { rawBody: Buffer }).rawBody)
      : Buffer.from(JSON.stringify(req.body));
    if (!verifyRevenueCatAuthorization(req.headers.authorization)) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid RevenueCat authorization header' } });
      return;
    }
    if (!verifyRevenueCatSignature(rawBody, req.headers['x-revenuecat-webhook-signature'] as string | undefined)) {
      res.status(401).json({ error: { code: 'invalid_signature', message: 'Invalid RevenueCat webhook signature' } });
      return;
    }
    try {
      const result = await processRevenueCatWebhook(db, req.body);
      res.json({ ok: true, duplicate: result.duplicate });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook processing failed';
      res.status(400).json({ error: { code: 'invalid_webhook', message } });
    }
  });

  return router;
}
