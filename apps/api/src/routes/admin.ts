import {
  adminLoginSchema,
  supportUpdateSchema,
  type AdminLoginInput,
  type AdminMetrics,
  type SupportUpdateInput,
} from '@zenfinance/shared';
import { and, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db/client.js';
import {
  appEvents,
  accounts,
  billingEntitlements,
  freelancerProfiles,
  householdGoals,
  householdInvites,
  householdMembers,
  households,
  insights,
  items,
  moneyWins,
  moneyPhysicalReports,
  referralCredits,
  referralRedemptions,
  supportRequests,
  transactionEnrichments,
  transactions,
  users,
  voiceBriefs,
  waitlistSignups,
} from '../db/schema.js';
import { issueAccessToken, issueRefreshToken, revokeRefreshToken, rotateRefreshToken, verifyAdminSecret } from '../lib/tokens.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { validateBody } from '../middleware/validate.js';
import { env } from '../env.js';

const FREELANCER_ADMIN_WINDOW_MONTHS = 6;
const FREELANCER_ESSENTIAL_CATEGORIES = new Set([
  'bills',
  'debt',
  'food_and_drink',
  'groceries',
  'healthcare',
  'home',
  'housing',
  'insurance',
  'medical',
  'rent',
  'taxes',
  'transportation',
  'utilities',
]);

function freelancerCategoryKey(category: string | null): string {
  return (category ?? '').trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '_').replaceAll(/^_+|_+$/g, '');
}

function freelancerEssentialSpend(category: string | null, isDiscretionary: boolean | null): boolean {
  if (isDiscretionary === true) return false;
  const key = freelancerCategoryKey(category);
  if (!key) return true;
  if (FREELANCER_ESSENTIAL_CATEGORIES.has(key)) return true;
  return [...FREELANCER_ESSENTIAL_CATEGORIES].some((essential) => key.includes(essential));
}

function freelancerWindowStart(): string {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  start.setUTCMonth(start.getUTCMonth() - (FREELANCER_ADMIN_WINDOW_MONTHS - 1));
  return start.toISOString().slice(0, 10);
}

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
    const [householdCount] = await db.select({ n: sql<number>`count(*)` }).from(households);
    const [householdMemberCount] = await db.select({ n: sql<number>`count(*)` }).from(householdMembers);
    const [householdInviteCount] = await db
      .select({ n: sql<number>`count(*)` })
      .from(householdInvites)
      .where(sql`${householdInvites.status} = 'pending' and ${householdInvites.expiresAt} > now()`);
    const [householdGoalCount] = await db.select({ n: sql<number>`count(*)` }).from(householdGoals);
    const [voiceBriefCount] = await db.select({ n: sql<number>`count(*)` }).from(voiceBriefs);
    const [voiceBriefCompletedCount] = await db
      .select({ n: sql<number>`count(*)` })
      .from(voiceBriefs)
      .where(sql`${voiceBriefs.completedAt} is not null`);
    const [voiceBriefAvgDuration] = await db
      .select({ seconds: sql<number | null>`avg(${voiceBriefs.durationSeconds})` })
      .from(voiceBriefs);
    const [moneyPhysicalCount] = await db.select({ n: sql<number>`count(*)` }).from(moneyPhysicalReports);
    const [moneyPhysicalAvgScore] = await db
      .select({ score: sql<number | null>`avg(${moneyPhysicalReports.score})` })
      .from(moneyPhysicalReports);
    const freelancerProfileRows = await db
      .select({
        userId: freelancerProfiles.userId,
        targetMonthlyIncomeCents: freelancerProfiles.targetMonthlyIncomeCents,
      })
      .from(freelancerProfiles)
      .where(eq(freelancerProfiles.enabled, true));
    const freelancerUserIds = freelancerProfileRows.map((profile) => profile.userId);
    let freelancerUsersWithIncome = 0;
    let freelancerAvgRunwayMonths: number | null = null;
    let freelancerAvgTargetGapCents: number | null = null;

    if (freelancerUserIds.length > 0) {
      const profileByUser = new Map(freelancerProfileRows.map((profile) => [profile.userId, profile]));
      const accountRows = await db
        .select({
          userId: items.userId,
          accountId: accounts.id,
          type: accounts.type,
          currentBalanceCents: accounts.currentBalanceCents,
        })
        .from(accounts)
        .innerJoin(items, eq(accounts.itemId, items.id))
        .where(inArray(items.userId, freelancerUserIds));
      const accountIds = accountRows.map((account) => account.accountId);
      const cashByUser = new Map<number, number>();
      for (const account of accountRows) {
        if ((account.type === 'depository' || account.type === 'cash') && account.currentBalanceCents !== null) {
          cashByUser.set(account.userId, (cashByUser.get(account.userId) ?? 0) + account.currentBalanceCents);
        }
      }

      const incomeByUser = new Map<number, number>();
      const essentialSpendByUser = new Map<number, number>();
      if (accountIds.length > 0) {
        const txRows = await db
          .select({
            userId: items.userId,
            amountCents: transactions.amountCents,
            category: transactionEnrichments.category,
            isDiscretionary: transactionEnrichments.isDiscretionary,
          })
          .from(transactions)
          .innerJoin(accounts, eq(transactions.accountId, accounts.id))
          .innerJoin(items, eq(accounts.itemId, items.id))
          .leftJoin(
            transactionEnrichments,
            and(eq(transactionEnrichments.transactionId, transactions.id), isNull(transactionEnrichments.supersededAt)),
          )
          .where(
            and(
              inArray(transactions.accountId, accountIds),
              isNull(transactions.removedAt),
              isNull(transactions.supersededAt),
              isNull(transactions.transferPairId),
              eq(transactions.pending, false),
              sql`${transactions.postedDate} >= ${freelancerWindowStart()}`,
            ),
          );

        for (const row of txRows) {
          if (row.amountCents < 0) {
            incomeByUser.set(row.userId, (incomeByUser.get(row.userId) ?? 0) + Math.abs(row.amountCents));
          } else if (row.amountCents > 0 && freelancerEssentialSpend(row.category, row.isDiscretionary)) {
            essentialSpendByUser.set(row.userId, (essentialSpendByUser.get(row.userId) ?? 0) + row.amountCents);
          }
        }
      }

      freelancerUsersWithIncome = [...incomeByUser.values()].filter((amount) => amount > 0).length;
      const runwayValues: number[] = [];
      const targetGapValues: number[] = [];
      for (const userId of freelancerUserIds) {
        const monthlyEssentialSpend = Math.round((essentialSpendByUser.get(userId) ?? 0) / FREELANCER_ADMIN_WINDOW_MONTHS);
        const cashBalance = cashByUser.get(userId);
        if (cashBalance !== undefined && monthlyEssentialSpend > 0) {
          runwayValues.push(cashBalance / monthlyEssentialSpend);
        }

        const target = profileByUser.get(userId)?.targetMonthlyIncomeCents;
        if (target !== null && target !== undefined) {
          const monthlyIncome = Math.round((incomeByUser.get(userId) ?? 0) / FREELANCER_ADMIN_WINDOW_MONTHS);
          targetGapValues.push(Math.max(0, target - monthlyIncome));
        }
      }
      freelancerAvgRunwayMonths = runwayValues.length
        ? Number((runwayValues.reduce((sum, value) => sum + value, 0) / runwayValues.length).toFixed(1))
        : null;
      freelancerAvgTargetGapCents = targetGapValues.length
        ? Math.round(targetGapValues.reduce((sum, value) => sum + value, 0) / targetGapValues.length)
        : null;
    }

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
      freelancer: {
        enabledUsers: freelancerUserIds.length,
        usersWithIncome: freelancerUsersWithIncome,
        avgRunwayMonths: freelancerAvgRunwayMonths,
        avgTargetGapCents: freelancerAvgTargetGapCents,
      },
      household: {
        households: Number(householdCount!.n),
        activeMembers: Number(householdMemberCount!.n),
        pendingInvites: Number(householdInviteCount!.n),
        sharedGoals: Number(householdGoalCount!.n),
      },
      voice: {
        generatedBriefs: Number(voiceBriefCount!.n),
        completedBriefs: Number(voiceBriefCompletedCount!.n),
        avgDurationSeconds: voiceBriefAvgDuration?.seconds === null ? null : Math.round(Number(voiceBriefAvgDuration!.seconds)),
      },
      moneyPhysical: {
        purchasedReports: Number(moneyPhysicalCount!.n),
        generatedReports: Number(moneyPhysicalCount!.n),
        avgScore: moneyPhysicalAvgScore?.score === null ? null : Math.round(Number(moneyPhysicalAvgScore!.score)),
        revenueCents: Number(moneyPhysicalCount!.n) * 1499,
      },
    };
    res.json(metrics);
  });

  adminRouter.get('/api/admin/waitlist', requireAdmin, async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

    if (req.query.format === 'csv') {
      const rows = await db.select().from(waitlistSignups).orderBy(desc(waitlistSignups.createdAt));
      const esc = (v: string) => {
        const neutralized = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
        return `"${neutralized.replaceAll('"', '""')}"`;
      };
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
