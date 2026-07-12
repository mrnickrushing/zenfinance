import {
  adminLoginSchema,
  supportUpdateSchema,
  type AdminLoginInput,
  type AdminMetrics,
  type SupportUpdateInput,
} from '@zenfinance/shared';
import { count, desc, eq, gte, sql } from 'drizzle-orm';
import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db/client.js';
import {
  appEvents,
  billingEntitlements,
  insights,
  items,
  moneyWins,
  referralCredits,
  referralRedemptions,
  supportRequests,
  users,
  waitlistSignups,
} from '../db/schema.js';
import {
  issueAccessToken,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyAdminSecret,
} from '../lib/tokens.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { validateBody } from '../middleware/validate.js';
import { env } from '../env.js';

export function createAdminRouter(): ReturnType<typeof Router> {
  const adminRouter = Router();

  const REFRESH_COOKIE = 'zf_admin_refresh';

  // House rule: 5 requests / 15 minutes on sensitive auth endpoints.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: { code: 'rate_limited', message: 'Too many login attempts, try again later' },
    },
  });

  function setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/admin',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  adminRouter.post(
    '/api/admin/login',
    loginLimiter,
    validateBody(adminLoginSchema),
    async (_req, res) => {
      const input = res.locals.body as AdminLoginInput;
      if (!verifyAdminSecret(input.secret)) {
        res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid credentials' } });
        return;
      }
      const refreshToken = await issueRefreshToken(db);
      setRefreshCookie(res, refreshToken);
      res.json({ accessToken: issueAccessToken() });
    },
  );

  adminRouter.post('/api/admin/refresh', async (req, res) => {
    const presented = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
    if (!presented) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Missing refresh token' } });
      return;
    }
    const rotated = await rotateRefreshToken(db, presented);
    if (!rotated) {
      res.clearCookie(REFRESH_COOKIE, { path: '/api/admin' });
      res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid refresh token' } });
      return;
    }
    setRefreshCookie(res, rotated.refreshToken);
    res.json({ accessToken: rotated.accessToken });
  });

  adminRouter.post('/api/admin/logout', async (req, res) => {
    const presented = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
    if (presented) await revokeRefreshToken(db, presented);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/admin' });
    res.json({ ok: true });
  });

  adminRouter.get('/api/admin/metrics', requireAdmin, async (_req, res) => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const [total] = await db.select({ n: count() }).from(waitlistSignups);
    const [last7] = await db
      .select({ n: count() })
      .from(waitlistSignups)
      .where(gte(waitlistSignups.createdAt, new Date(now - 7 * day)));
    const [last30] = await db
      .select({ n: count() })
      .from(waitlistSignups)
      .where(gte(waitlistSignups.createdAt, new Date(now - 30 * day)));
    const daily = await db
      .select({
        date: sql<string>`to_char(${waitlistSignups.createdAt}::date, 'YYYY-MM-DD')`,
        count: count(),
      })
      .from(waitlistSignups)
      .where(gte(waitlistSignups.createdAt, new Date(now - 30 * day)))
      .groupBy(sql`${waitlistSignups.createdAt}::date`)
      .orderBy(sql`${waitlistSignups.createdAt}::date`);
    const [supportTotal] = await db.select({ n: count() }).from(supportRequests);
    const [supportOpen] = await db
      .select({ n: count() })
      .from(supportRequests)
      .where(eq(supportRequests.status, 'open'));
    const [registeredUsers] = await db.select({ n: count() }).from(users);
    const [linkedUsers] = await db.select({ n: sql<number>`count(distinct ${items.userId})` }).from(items);
    const [firstBriefUsers] = await db
      .select({ n: sql<number>`count(distinct ${insights.userId})` })
      .from(insights)
      .where(eq(insights.kind, 'first_look'));
    const [actedUsers] = await db
      .select({ n: sql<number>`count(distinct ${insights.userId})` })
      .from(insights)
      .where(eq(insights.feedbackFollowedThrough, true));
    const [retainedWeek4Users] = await db
      .select({ n: sql<number>`count(distinct ${users.id})` })
      .from(users)
      .innerJoin(appEvents, eq(appEvents.userId, users.id))
      .where(sql`${users.createdAt} <= now() - interval '28 days' and ${appEvents.createdAt} >= ${users.createdAt} + interval '28 days'`);
    const [active7] = await db
      .select({ n: sql<number>`count(distinct ${appEvents.userId})` })
      .from(appEvents)
      .where(gte(appEvents.createdAt, new Date(now - 7 * day)));
    const [active30] = await db
      .select({ n: sql<number>`count(distinct ${appEvents.userId})` })
      .from(appEvents)
      .where(gte(appEvents.createdAt, new Date(now - 30 * day)));
    const [premiumUsers] = await db
      .select({ n: sql<number>`count(distinct ${users.id})` })
      .from(users)
      .leftJoin(billingEntitlements, eq(billingEntitlements.userId, users.id))
      .leftJoin(referralCredits, eq(referralCredits.recipientUserId, users.id))
      .where(sql`(
        ${billingEntitlements.status} in ('trialing', 'active', 'grace_period')
        and (${billingEntitlements.expiresAt} is null or ${billingEntitlements.expiresAt} > now())
      ) or (
        ${referralCredits.status} = 'applied'
        and ${referralCredits.expiresAt} > now()
      )`);
    const [trialUsers] = await db
      .select({ n: sql<number>`count(distinct ${billingEntitlements.userId})` })
      .from(billingEntitlements)
      .where(sql`${billingEntitlements.status} = 'trialing' and (${billingEntitlements.expiresAt} is null or ${billingEntitlements.expiresAt} > now())`);
    const [paidUsers] = await db
      .select({ n: sql<number>`count(distinct ${billingEntitlements.userId})` })
      .from(billingEntitlements)
      .where(sql`${billingEntitlements.status} = 'active' and ${billingEntitlements.plan} in ('monthly', 'annual') and (${billingEntitlements.expiresAt} is null or ${billingEntitlements.expiresAt} > now())`);
    const [monthlyUsers] = await db
      .select({ n: sql<number>`count(*)` })
      .from(billingEntitlements)
      .where(sql`${billingEntitlements.status} = 'active' and ${billingEntitlements.plan} = 'monthly' and (${billingEntitlements.expiresAt} is null or ${billingEntitlements.expiresAt} > now())`);
    const [annualUsers] = await db
      .select({ n: sql<number>`count(*)` })
      .from(billingEntitlements)
      .where(sql`${billingEntitlements.status} = 'active' and ${billingEntitlements.plan} = 'annual' and (${billingEntitlements.expiresAt} is null or ${billingEntitlements.expiresAt} > now())`);
    const [churnedUsers] = await db
      .select({ n: sql<number>`count(distinct ${billingEntitlements.userId})` })
      .from(billingEntitlements)
      .where(sql`${billingEntitlements.status} in ('expired', 'refunded')`);
    const [everBilledUsers] = await db
      .select({ n: sql<number>`count(distinct ${billingEntitlements.userId})` })
      .from(billingEntitlements);
    const [verifiedWins] = await db
      .select({ amountCents: sql<number>`coalesce(sum(${moneyWins.amountCents}), 0)` })
      .from(moneyWins)
      .where(eq(moneyWins.status, 'verified'));
    const [referralRedemptionCount] = await db.select({ n: sql<number>`count(*)` }).from(referralRedemptions);
    const [referralCreditCount] = await db.select({ n: sql<number>`count(*)` }).from(referralCredits);

    const userCount = Number(registeredUsers!.n);
    const linkedUserCount = Number(linkedUsers!.n);
    const firstBriefUserCount = Number(firstBriefUsers!.n);
    const actedUserCount = Number(actedUsers!.n);
    const retainedWeek4UserCount = Number(retainedWeek4Users!.n);
    const paidUserCount = Number(paidUsers!.n);
    const everBilledUserCount = Number(everBilledUsers!.n);

    const metrics: AdminMetrics = {
      waitlist: {
        total: total!.n,
        last7Days: last7!.n,
        last30Days: last30!.n,
        dailySignups: daily.map((d) => ({ date: d.date, count: d.count })),
      },
      support: {
        total: supportTotal!.n,
        open: supportOpen!.n,
        resolved: supportTotal!.n - supportOpen!.n,
      },
      beta: {
        registeredUsers: userCount,
        linkedUsers: linkedUserCount,
        firstBriefUsers: firstBriefUserCount,
        actedUsers: actedUserCount,
        retainedWeek4Users: retainedWeek4UserCount,
        activationRate: userCount ? firstBriefUserCount / userCount : 0,
        actionRate: userCount ? actedUserCount / userCount : 0,
        week4RetentionRate: userCount ? retainedWeek4UserCount / userCount : 0,
      },
      launch: {
        activeUsers7Days: Number(active7!.n),
        activeUsers30Days: Number(active30!.n),
        premiumUsers: Number(premiumUsers!.n),
        trialUsers: Number(trialUsers!.n),
        paidUsers: paidUserCount,
        paidConversionRate: userCount ? paidUserCount / userCount : 0,
        churnedUsers: Number(churnedUsers!.n),
        churnRate: everBilledUserCount ? Number(churnedUsers!.n) / everBilledUserCount : 0,
        mrrCents: Number(monthlyUsers!.n) * 799 + Math.round((Number(annualUsers!.n) * 5999) / 12),
        verifiedMoneyWinsAvgCents: userCount ? Math.round(Number(verifiedWins!.amountCents) / userCount) : 0,
        referralRedemptions: Number(referralRedemptionCount!.n),
        referralCreditsAwarded: Number(referralCreditCount!.n),
      },
    };
    res.json(metrics);
  });

  adminRouter.get('/api/admin/waitlist', requireAdmin, async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

    if (req.query.format === 'csv') {
      const rows = await db.select().from(waitlistSignups).orderBy(desc(waitlistSignups.createdAt));
      const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
      const csv = [
        'id,email,source,created_at',
        ...rows.map((r) =>
          [r.id, esc(r.email), esc(r.source ?? ''), r.createdAt.toISOString()].join(','),
        ),
      ].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="zenfinance-waitlist.csv"');
      res.send(csv);
      return;
    }

    const [total] = await db.select({ n: count() }).from(waitlistSignups);
    const items = await db
      .select()
      .from(waitlistSignups)
      .orderBy(desc(waitlistSignups.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    res.json({
      items: items.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      total: total!.n,
      page,
      pageSize,
    });
  });

  adminRouter.get('/api/admin/support', requireAdmin, async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    const [total] = await db.select({ n: count() }).from(supportRequests);
    const items = await db
      .select()
      .from(supportRequests)
      .orderBy(desc(supportRequests.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    res.json({
      items: items.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      total: total!.n,
      page,
      pageSize,
    });
  });

  adminRouter.patch(
    '/api/admin/support/:id',
    requireAdmin,
    validateBody(supportUpdateSchema),
    async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid ticket id' } });
        return;
      }
      const input = res.locals.body as SupportUpdateInput;
      const [updated] = await db
        .update(supportRequests)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(supportRequests.id, id))
        .returning({ id: supportRequests.id });
      if (!updated) {
        res.status(404).json({ error: { code: 'not_found', message: 'Ticket not found' } });
        return;
      }
      res.json({ ok: true });
    },
  );

  return adminRouter;
}
