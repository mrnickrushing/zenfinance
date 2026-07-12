import {
  createGoalSchema,
  updateGoalSchema,
  type CreateGoalInput,
  type GoalView,
  type UpdateGoalInput,
} from '@zenfinance/shared';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { Router } from 'express';
import { FREE_LIMITS, userHasPremium } from '../billing/service.js';
import { computeGoalPacing, type Goal } from '../coaching/goals.js';
import { db } from '../db/client.js';
import { goals } from '../db/schema.js';
import { getRecentWeeklyNetCents } from '../features/rollup.js';
import { requireUser } from '../middleware/userAuth.js';
import { validateBody } from '../middleware/validate.js';

function toView(goal: Goal, recentWeeklyNetCents: number): GoalView {
  const pacing = computeGoalPacing(goal, recentWeeklyNetCents);
  return {
    id: goal.id,
    name: goal.name,
    targetAmountCents: goal.targetAmountCents,
    currentAmountCents: goal.currentAmountCents,
    targetDate: goal.targetDate,
    priority: goal.priority,
    status: goal.status,
    pacing: {
      remainingAmountCents: pacing.remainingAmountCents,
      progressRatio: pacing.progressRatio,
      weeksRemaining: pacing.weeksRemaining,
      weeklyTargetCents: pacing.weeklyTargetCents,
      projectedCompletionDate: pacing.projectedCompletionDate,
      pacingStatus: pacing.pacingStatus,
    },
  };
}

export function createGoalsRouter(): ReturnType<typeof Router> {
  const router = Router();

  router.get('/api/goals', requireUser, async (_req, res) => {
    const userId = res.locals.userId as number;
    const [rows, net] = await Promise.all([
      db.select().from(goals).where(eq(goals.userId, userId)).orderBy(asc(goals.priority), asc(goals.id)),
      getRecentWeeklyNetCents(db, userId),
    ]);
    res.json({ items: rows.map((g) => toView(g, net)) });
  });

  router.post('/api/goals', requireUser, validateBody(createGoalSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    const input = res.locals.body as CreateGoalInput;
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${userId}, 1002)`);
      if (!(await userHasPremium(tx as unknown as typeof db, userId))) {
        const [row] = await tx.select({ n: count() }).from(goals).where(and(eq(goals.userId, userId), eq(goals.status, 'active')));
        const max = FREE_LIMITS.maxActiveGoals ?? Number.POSITIVE_INFINITY;
        if ((row?.n ?? 0) >= max) return { status: 'limit' as const };
      }
      const [goal] = await tx
        .insert(goals)
        .values({
          userId,
          name: input.name,
          targetAmountCents: input.targetAmountCents,
          currentAmountCents: input.currentAmountCents ?? 0,
          targetDate: input.targetDate ?? null,
          priority: input.priority ?? 1,
        })
        .returning();
      return { status: 'created' as const, goal: goal! };
    });
    if (result.status === 'limit') {
      res.status(402).json({
        error: { code: 'premium_required', message: 'Free accounts can keep 1 active goal. Upgrade to ZenFinance Coach for multiple goals.', details: { feature: 'multiple_goals' } },
      });
      return;
    }
    const net = await getRecentWeeklyNetCents(db, userId);
    res.status(201).json(toView(result.goal, net));
  });

  router.patch('/api/goals/:id', requireUser, validateBody(updateGoalSchema), async (req, res) => {
    const userId = res.locals.userId as number;
    const input = res.locals.body as UpdateGoalInput;
    const id = Number(req.params.id);

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${userId}, 1002)`);
      const [existing] = await tx
        .select()
        .from(goals)
        .where(and(eq(goals.id, id), eq(goals.userId, userId)))
        .limit(1);
      if (!existing) return { status: 'missing' as const };
      const nextStatus = input.status ?? existing.status;
      if (nextStatus === 'active' && !(await userHasPremium(tx as unknown as typeof db, userId))) {
        const [row] = await tx
          .select({ n: count() })
          .from(goals)
          .where(and(eq(goals.userId, userId), eq(goals.status, 'active'), ne(goals.id, existing.id)));
        const max = FREE_LIMITS.maxActiveGoals ?? Number.POSITIVE_INFINITY;
        if ((row?.n ?? 0) >= max) return { status: 'limit' as const };
      }

      const [updated] = await tx
        .update(goals)
        .set({
          name: input.name ?? existing.name,
          targetAmountCents: input.targetAmountCents ?? existing.targetAmountCents,
          currentAmountCents: input.currentAmountCents ?? existing.currentAmountCents,
          targetDate: input.targetDate === undefined ? existing.targetDate : input.targetDate,
          priority: input.priority ?? existing.priority,
          status: input.status ?? existing.status,
          updatedAt: new Date(),
        })
        .where(eq(goals.id, existing.id))
        .returning();
      return { status: 'updated' as const, goal: updated! };
    });
    if (result.status === 'missing') {
      res.status(404).json({ error: { code: 'not_found', message: 'Goal not found' } });
      return;
    }
    if (result.status === 'limit') {
      res.status(402).json({
        error: { code: 'premium_required', message: 'Free accounts can keep 1 active goal. Upgrade to ZenFinance Coach for multiple goals.', details: { feature: 'multiple_goals' } },
      });
      return;
    }

    const net = await getRecentWeeklyNetCents(db, userId);
    res.json(toView(result.goal, net));
  });

  router.delete('/api/goals/:id', requireUser, async (req, res) => {
    const userId = res.locals.userId as number;
    const id = Number(req.params.id);
    const [existing] = await db
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.id, id), eq(goals.userId, userId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: { code: 'not_found', message: 'Goal not found' } });
      return;
    }
    await db.delete(goals).where(eq(goals.id, existing.id));
    res.json({ ok: true });
  });

  return router;
}
