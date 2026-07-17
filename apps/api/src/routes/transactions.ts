import {
  categoryCorrectionSchema,
  type CategoryCorrectionInput,
  type EnrichedTransactionView,
  type FeatureRollupView,
  type RecurringStreamView,
} from '@zenfinance/shared';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client.js';
import {
  accounts,
  categoryCorrections,
  featureRollups,
  items,
  recurringStreams,
  transactionEnrichments,
  transactions,
} from '../db/schema.js';
import { defaultDiscretionaryFor, isValidCategory } from '../enrichment/categories.js';
import { applyEnrichment } from '../enrichment/pipeline.js';
import { cleanMerchantName, merchantKey as computeMerchantKey } from '../enrichment/textNormalize.js';
import { requireUser } from '../middleware/userAuth.js';
import { userRateLimit } from '../middleware/userRateLimit.js';
import { validateBody } from '../middleware/validate.js';
import { getProvider } from '../providers/index.js';
import { safeErrorSummary } from '../lib/safeError.js';
import { refreshUserBalances } from '../sync/engine.js';

export function createTransactionsRouter(): ReturnType<typeof Router> {
  const router = Router();

  // Pull-to-refresh: forces a live balance check with each linked
  // institution instead of waiting for the next scheduled sync. Kept
  // separate from a full transaction resync so it stays fast.
  router.post('/api/accounts/refresh-balances', requireUser, userRateLimit('refresh-balances', {
    windowMs: 60 * 1000,
    limit: 6,
    message: 'Too many balance refreshes. Please wait a minute.',
  }), async (_req, res) => {
    const userId = res.locals.userId as number;
    try {
      await refreshUserBalances(db, getProvider(), userId);
      res.json({ ok: true });
    } catch (err) {
      console.error('[accounts] refreshBalances failed:', safeErrorSummary(err));
      res.status(502).json({
        error: { code: 'balance_refresh_failed', message: 'Could not refresh balances right now. Please try again in a moment.' },
      });
    }
  });

  router.get('/api/transactions', requireUser, async (req, res) => {
    const userId = res.locals.userId as number;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

    const accountRows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .innerJoin(items, eq(accounts.itemId, items.id))
      .where(eq(items.userId, userId));
    const accountIds = accountRows.map((a) => a.id);
    if (accountIds.length === 0) {
      res.json({ items: [], total: 0, page, pageSize });
      return;
    }

    const visible = and(
      inArray(transactions.accountId, accountIds),
      isNull(transactions.removedAt),
      isNull(transactions.supersededAt),
    );
    const [total] = await db.select({ n: count() }).from(transactions).where(visible);
    const rows = await db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        amountCents: transactions.amountCents,
        isoCurrency: transactions.isoCurrency,
        postedDate: transactions.postedDate,
        name: transactions.name,
        merchantName: transactions.merchantName,
        pending: transactions.pending,
        transferPairId: transactions.transferPairId,
        category: transactionEnrichments.category,
        merchantClean: transactionEnrichments.merchantClean,
        isDiscretionary: transactionEnrichments.isDiscretionary,
        isRecurring: transactionEnrichments.isRecurring,
        confidence: transactionEnrichments.confidence,
        enrichmentSource: transactionEnrichments.source,
      })
      .from(transactions)
      .leftJoin(
        transactionEnrichments,
        and(eq(transactionEnrichments.transactionId, transactions.id), isNull(transactionEnrichments.supersededAt)),
      )
      .where(visible)
      .orderBy(desc(transactions.postedDate), desc(transactions.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const view: EnrichedTransactionView[] = rows.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      amountCents: t.amountCents,
      isoCurrency: t.isoCurrency,
      postedDate: t.postedDate,
      name: t.name,
      merchantName: t.merchantName,
      pending: t.pending,
      transferPairId: t.transferPairId,
      category: t.category,
      merchantClean: t.merchantClean,
      isDiscretionary: t.isDiscretionary,
      isRecurring: t.isRecurring,
      confidence: t.confidence,
      enrichmentSource: t.enrichmentSource,
    }));

    res.json({ items: view, total: total!.n, page, pageSize });
  });

  // User-correction loop (PLAN §4 Stage 2): the correction both fixes this
  // transaction immediately and is stored as a few-shot example the
  // enrichment pipeline injects for this user's future transactions.
  router.patch(
    '/api/transactions/:id/category',
    requireUser,
    validateBody(categoryCorrectionSchema),
    async (req, res) => {
      const userId = res.locals.userId as number;
      const input = res.locals.body as CategoryCorrectionInput;
      const transactionId = Number(req.params.id);

      if (!isValidCategory(input.category)) {
        res.status(400).json({
          error: { code: 'invalid_request', message: `Unknown category: ${input.category}` },
        });
        return;
      }

      const [row] = await db
        .select({
          id: transactions.id,
          name: transactions.name,
          merchantName: transactions.merchantName,
          currentCategory: transactionEnrichments.category,
          currentIsRecurring: transactionEnrichments.isRecurring,
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .innerJoin(items, eq(accounts.itemId, items.id))
        .leftJoin(
          transactionEnrichments,
          and(eq(transactionEnrichments.transactionId, transactions.id), isNull(transactionEnrichments.supersededAt)),
        )
        .where(and(eq(transactions.id, transactionId), eq(items.userId, userId)))
        .limit(1);

      if (!row) {
        res.status(404).json({ error: { code: 'not_found', message: 'Transaction not found' } });
        return;
      }

      const isDiscretionary = input.isDiscretionary ?? defaultDiscretionaryFor(input.category);
      const merchantClean = cleanMerchantName(row.name, row.merchantName);
      const merchantKey = computeMerchantKey(row.name, row.merchantName);

      await db.insert(categoryCorrections).values({
        userId,
        transactionId,
        merchantKey,
        originalCategory: row.currentCategory,
        correctedCategory: input.category,
        correctedIsDiscretionary: isDiscretionary,
      });

      await applyEnrichment(db, transactionId, {
        category: input.category,
        merchantClean,
        isRecurring: row.currentIsRecurring ?? false,
        isDiscretionary,
        confidence: 1,
        source: 'user_correction',
        model: null,
      });

      res.json({ ok: true });
    },
  );

  router.get('/api/recurring-streams', requireUser, async (_req, res) => {
    const userId = res.locals.userId as number;
    const rows = await db
      .select()
      .from(recurringStreams)
      .where(and(eq(recurringStreams.userId, userId), eq(recurringStreams.active, true)))
      .orderBy(desc(recurringStreams.avgAmountCents));

    const view: RecurringStreamView[] = rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      merchantClean: r.merchantClean,
      cadence: r.cadence,
      avgAmountCents: r.avgAmountCents,
      lastAmountCents: r.lastAmountCents,
      occurrences: r.occurrences,
      firstSeenDate: r.firstSeenDate,
      lastSeenDate: r.lastSeenDate,
      nextExpectedDate: r.nextExpectedDate,
      active: r.active,
    }));
    res.json({ items: view });
  });

  router.get('/api/features/rollups', requireUser, async (req, res) => {
    const userId = res.locals.userId as number;
    const weeks = Math.min(26, Math.max(1, Number(req.query.weeks) || 8));

    const rows = await db
      .select({
        weekStart: featureRollups.weekStart,
        metric: featureRollups.metric,
        category: featureRollups.category,
        valueCents: featureRollups.valueCents,
        valueRatio: featureRollups.valueRatio,
      })
      .from(featureRollups)
      .where(eq(featureRollups.userId, userId))
      .orderBy(desc(featureRollups.weekStart));

    const distinctWeeks = [...new Set(rows.map((r) => r.weekStart))].slice(0, weeks);
    const weekSet = new Set(distinctWeeks);
    const view: FeatureRollupView[] = rows.filter((r) => weekSet.has(r.weekStart));
    res.json({ items: view });
  });

  return router;
}
