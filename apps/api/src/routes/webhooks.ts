import { eq } from 'drizzle-orm';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db/client.js';
import { items } from '../db/schema.js';
import { env } from '../env.js';
import { getProvider } from '../providers/index.js';
import { enqueueItemSync } from '../queue/index.js';

const SYNC_CODES = new Set(['SYNC_UPDATES_AVAILABLE', 'DEFAULT_UPDATE', 'INITIAL_UPDATE', 'HISTORICAL_UPDATE']);
const LOGIN_REQUIRED_ITEM_CODES = new Set(['ERROR', 'PENDING_EXPIRATION', 'PENDING_DISCONNECT']);
const DISCONNECTED_ITEM_CODES = new Set(['USER_PERMISSION_REVOKED', 'USER_ACCOUNT_REVOKED']);

export function createWebhooksRouter(): ReturnType<typeof Router> {
  const webhooksRouter = Router();

  const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Plaid webhooks. Always answers 200 with no detail — the body is untrusted
  // input that can at most update/sync an item we already hold, and revealing
  // whether an item exists would be an oracle.
  webhooksRouter.post('/api/webhooks/plaid', webhookLimiter, async (req, res) => {
    try {
      const verificationHeader = req.headers['plaid-verification'];
      const provider = getProvider();
      const rawBody = (req as { rawBody?: Buffer }).rawBody;
      const validWebhook =
        provider.verifyWebhook && Buffer.isBuffer(rawBody) && typeof verificationHeader !== 'object'
          ? await provider.verifyWebhook(rawBody, verificationHeader)
          : env.NODE_ENV !== 'production';
      if (!validWebhook) {
        res.status(401).json({ error: { code: 'invalid_signature', message: 'Invalid Plaid webhook signature' } });
        return;
      }

      const body = req.body as {
        webhook_type?: string;
        webhook_code?: string;
        item_id?: string;
        error?: { error_code?: string };
      };
      if (typeof body.item_id !== 'string' || body.item_id.length === 0) {
        res.json({ ok: true });
        return;
      }

      const [item] = await db
        .select({ id: items.id })
        .from(items)
        .where(eq(items.providerItemId, body.item_id))
        .limit(1);
      if (!item) {
        res.json({ ok: true });
        return;
      }

      if (body.webhook_type === 'ITEM') {
        if (body.webhook_code === 'LOGIN_REPAIRED') {
          await db.update(items).set({ status: 'active', updatedAt: new Date() }).where(eq(items.id, item.id));
          res.json({ ok: true });
          return;
        }
        const needsUpdateMode =
          LOGIN_REQUIRED_ITEM_CODES.has(body.webhook_code ?? '') || body.error?.error_code === 'ITEM_LOGIN_REQUIRED';
        if (needsUpdateMode) {
          await db.update(items).set({ status: 'login_required', updatedAt: new Date() }).where(eq(items.id, item.id));
          res.json({ ok: true });
          return;
        }
        if (DISCONNECTED_ITEM_CODES.has(body.webhook_code ?? '')) {
          await db.update(items).set({ status: 'disconnected', updatedAt: new Date() }).where(eq(items.id, item.id));
          res.json({ ok: true });
          return;
        }
      }

      if (body.webhook_type === 'TRANSACTIONS' && SYNC_CODES.has(body.webhook_code ?? '')) {
        await enqueueItemSync(item.id);
      }
    } catch (err) {
      console.error('[webhook] plaid webhook processing failed:', err);
    }

    res.json({ ok: true });
  });

  return webhooksRouter;
}
