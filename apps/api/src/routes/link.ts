import {
  linkExchangeSchema,
  type LinkExchangeInput,
  type LinkedItem,
} from '@zenfinance/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client.js';
import { accounts, items, users } from '../db/schema.js';
import { decryptToken, encryptToken } from '../lib/crypto.js';
import { requireUser } from '../middleware/userAuth.js';
import { validateBody } from '../middleware/validate.js';
import { getProvider } from '../providers/index.js';
import { enqueueItemSync } from '../queue/index.js';

export function createLinkRouter(): ReturnType<typeof Router> {
  const linkRouter = Router();

  linkRouter.post('/api/link/token', requireUser, async (_req, res) => {
    const { linkToken } = await getProvider().createLinkToken(res.locals.userId as number);
    res.json({ linkToken });
  });

  linkRouter.post(
    '/api/link/exchange',
    requireUser,
    validateBody(linkExchangeSchema),
    async (_req, res) => {
      const userId = res.locals.userId as number;
      const input = res.locals.body as LinkExchangeInput;
      const provider = getProvider();

      const exchanged = await provider.exchangePublicToken(input.publicToken);
      const [item] = await db
        .insert(items)
        .values({
          userId,
          provider: provider.name,
          providerItemId: exchanged.providerItemId,
          encryptedAccessToken: encryptToken(exchanged.accessToken),
          institutionName: input.institutionName ?? null,
        })
        .onConflictDoNothing({ target: items.providerItemId })
        .returning();
      if (!item) {
        res.status(409).json({
          error: { code: 'conflict', message: 'This account connection already exists' },
        });
        return;
      }

      const providerAccounts = await provider.fetchAccounts(exchanged.accessToken);
      for (const a of providerAccounts) {
        await db
          .insert(accounts)
          .values({ itemId: item.id, ...a })
          .onConflictDoNothing({ target: [accounts.itemId, accounts.providerAccountId] });
      }

      // 90-day backfill starts immediately — first insight within a minute of linking.
      await enqueueItemSync(item.id);

      res.status(201).json(await itemView(item.id));
    },
  );

  linkRouter.get('/api/items', requireUser, async (_req, res) => {
    const userId = res.locals.userId as number;
    const rows = await db
      .select({ id: items.id })
      .from(items)
      .where(eq(items.userId, userId))
      .orderBy(desc(items.createdAt));
    res.json({ items: await Promise.all(rows.map((r) => itemView(r.id))) });
  });

  // One-tap disconnect: revoke at the provider, then hard-delete the item —
  // accounts and transactions go with it (FK cascade). Built now, per PLAN §5.
  linkRouter.delete('/api/items/:id', requireUser, async (req, res) => {
    const userId = res.locals.userId as number;
    const id = Number(req.params.id);
    const [item] = await db
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.userId, userId)))
      .limit(1);
    if (!item) {
      res.status(404).json({ error: { code: 'not_found', message: 'Item not found' } });
      return;
    }
    try {
      await getProvider().removeItem(decryptToken(item.encryptedAccessToken));
    } catch (err) {
      // Provider revocation failing must not block the user's deletion right.
      console.error(`[link] provider removeItem failed for item ${item.id}:`, err);
    }
    await db.delete(items).where(eq(items.id, item.id));
    res.json({ ok: true });
  });

  // Full account deletion: revoke every provider connection, then delete the
  // user row — everything else cascades.
  linkRouter.delete('/api/me', requireUser, async (_req, res) => {
    const userId = res.locals.userId as number;
    const userItems = await db.select().from(items).where(eq(items.userId, userId));
    for (const item of userItems) {
      try {
        await getProvider().removeItem(decryptToken(item.encryptedAccessToken));
      } catch (err) {
        console.error(`[link] provider removeItem failed for item ${item.id}:`, err);
      }
    }
    await db.delete(users).where(eq(users.id, userId));
    res.json({ ok: true });
  });

  return linkRouter;
}

async function itemView(itemId: number): Promise<LinkedItem> {
  const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  const accountRows = await db.select().from(accounts).where(eq(accounts.itemId, itemId));
  return {
    id: item!.id,
    provider: item!.provider,
    institutionName: item!.institutionName,
    status: item!.status,
    lastSyncedAt: item!.lastSyncedAt?.toISOString() ?? null,
    accounts: accountRows.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      mask: a.mask,
      currentBalanceCents: a.currentBalanceCents,
      isoCurrency: a.isoCurrency,
    })),
  };
}
