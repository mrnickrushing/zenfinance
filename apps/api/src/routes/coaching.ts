import {
  anomalyUpdateSchema,
  cancelSubscriptionSchema,
  insightFeedbackSchema,
  type AnomalyUpdateInput,
  type AnomalyView,
  type CancelSubscriptionInput,
  type InsightClaim,
  type InsightFeedbackInput,
  type InsightView,
} from '@zenfinance/shared';
import type { InferSelectModel } from 'drizzle-orm';
import { and, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { auditSubscriptions } from '../coaching/subscriptions.js';
import {
  confirmMoneyWin,
  getMoneyWinsSummary,
  recordAnomalyRecovery,
  recordSubscriptionCancellation,
} from '../coaching/moneyWins.js';
import { db } from '../db/client.js';
import { anomalies, insights } from '../db/schema.js';
import { requirePremium } from '../middleware/billing.js';
import { requireUser } from '../middleware/userAuth.js';
import { validateBody } from '../middleware/validate.js';

type InsightRow = InferSelectModel<typeof insights>;

function insightToView(row: InsightRow): InsightView {
  return {
    id: row.id,
    kind: row.kind,
    weekStart: row.weekStart,
    headline: row.headline,
    body: row.body,
    action: {
      description: row.actionDescription,
      estimatedImpactCents: row.actionEstimatedImpactCents,
      timeframe: row.actionTimeframe,
    },
    claims: (row.claims as InsightClaim[]) ?? [],
    toneCheck: row.toneCheck,
    source: row.source,
    feedbackRating: row.feedbackRating,
    feedbackFollowedThrough: row.feedbackFollowedThrough,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createCoachingRouter(): ReturnType<typeof Router> {
  const router = Router();

  // --- insights ---
  router.get('/api/insights', requireUser, async (req, res) => {
    const userId = res.locals.userId as number;
    const kind = req.query.kind;
    const filters = [eq(insights.userId, userId)];
    if (kind === 'first_look' || kind === 'weekly_brief') {
      filters.push(eq(insights.kind, kind));
    }
    const rows = await db
      .select()
      .from(insights)
      .where(and(...filters))
      .orderBy(desc(insights.createdAt))
      .limit(50);
    res.json({ items: rows.map(insightToView) });
  });

  router.get('/api/insights/latest', requireUser, async (req, res) => {
    const userId = res.locals.userId as number;
    const kind = req.query.kind === 'first_look' ? 'first_look' : 'weekly_brief';
    const [row] = await db
      .select()
      .from(insights)
      .where(and(eq(insights.userId, userId), eq(insights.kind, kind)))
      .orderBy(desc(insights.createdAt))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: { code: 'not_found', message: 'No insight yet' } });
      return;
    }
    res.json(insightToView(row));
  });

  // Feedback loop (§4 Stage 5): thumbs + next-week "did you do it?".
  router.post('/api/insights/:id/feedback', requireUser, validateBody(insightFeedbackSchema), async (req, res) => {
    const userId = res.locals.userId as number;
    const input = res.locals.body as InsightFeedbackInput;
    const id = Number(req.params.id);
    const [existing] = await db
      .select({ id: insights.id })
      .from(insights)
      .where(and(eq(insights.id, id), eq(insights.userId, userId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: { code: 'not_found', message: 'Insight not found' } });
      return;
    }
    await db
      .update(insights)
      .set({
        ...(input.rating !== undefined ? { feedbackRating: input.rating } : {}),
        ...(input.followedThrough !== undefined ? { feedbackFollowedThrough: input.followedThrough } : {}),
      })
      .where(eq(insights.id, existing.id));
    res.json({ ok: true });
  });

  // --- anomalies ---
  router.get('/api/anomalies', requireUser, async (_req, res) => {
    const userId = res.locals.userId as number;
    const rows = await db
      .select()
      .from(anomalies)
      .where(and(eq(anomalies.userId, userId), eq(anomalies.status, 'open')))
      .orderBy(desc(anomalies.amountCents));
    const view: AnomalyView[] = rows.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      detail: a.detail,
      amountCents: a.amountCents,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
    }));
    res.json({ items: view });
  });

  router.patch('/api/anomalies/:id', requireUser, validateBody(anomalyUpdateSchema), async (req, res) => {
    const userId = res.locals.userId as number;
    const input = res.locals.body as AnomalyUpdateInput;
    const id = Number(req.params.id);
    const [existing] = await db
      .select({ id: anomalies.id })
      .from(anomalies)
      .where(and(eq(anomalies.id, id), eq(anomalies.userId, userId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: { code: 'not_found', message: 'Anomaly not found' } });
      return;
    }
    await db.update(anomalies).set({ status: input.status }).where(eq(anomalies.id, existing.id));
    res.json({ ok: true });
  });

  // User confirms they recovered money on a flagged anomaly → a verified win.
  router.post('/api/anomalies/:id/recover', requireUser, async (req, res) => {
    const userId = res.locals.userId as number;
    const id = Number(req.params.id);
    const result = await recordAnomalyRecovery(db, userId, id);
    if (!result.ok) {
      res.status(404).json({ error: { code: 'not_found', message: result.reason ?? 'Anomaly not found' } });
      return;
    }
    res.json({ ok: true });
  });

  // --- subscription auditor ---
  router.get('/api/subscriptions', requireUser, requirePremium('subscription_audit'), async (_req, res) => {
    const userId = res.locals.userId as number;
    res.json(await auditSubscriptions(db, userId));
  });

  router.post(
    '/api/subscriptions/cancel',
    requireUser,
    requirePremium('subscription_audit'),
    validateBody(cancelSubscriptionSchema),
    async (_req, res) => {
      const userId = res.locals.userId as number;
      const input = res.locals.body as CancelSubscriptionInput;
      const result = await recordSubscriptionCancellation(db, userId, input.recurringStreamId);
      if (!result.ok) {
        res.status(404).json({ error: { code: 'not_found', message: result.reason ?? 'Not found' } });
        return;
      }
      res.status(201).json({ ok: true });
    },
  );

  // --- money wins ledger ---
  router.get('/api/money-wins', requireUser, requirePremium('money_wins'), async (_req, res) => {
    const userId = res.locals.userId as number;
    res.json(await getMoneyWinsSummary(db, userId));
  });

  router.post('/api/money-wins/:id/confirm', requireUser, requirePremium('money_wins'), async (req, res) => {
    const userId = res.locals.userId as number;
    const id = Number(req.params.id);
    const result = await confirmMoneyWin(db, userId, id);
    if (!result.ok) {
      res.status(404).json({ error: { code: 'not_found', message: 'Money win not found' } });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
