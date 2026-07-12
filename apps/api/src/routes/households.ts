import crypto from 'node:crypto';
import {
  householdCreateSchema,
  householdGoalContributionSchema,
  householdGoalCreateSchema,
  householdGoalUpdateSchema,
  householdInviteAcceptSchema,
  householdInviteCreateSchema,
  type HouseholdCreateInput,
  type HouseholdGoalContributionInput,
  type HouseholdGoalContributionView,
  type HouseholdGoalCreateInput,
  type HouseholdGoalUpdateInput,
  type HouseholdInviteAcceptInput,
  type HouseholdInviteCreateInput,
  type HouseholdInviteCreatedView,
  type HouseholdInviteView,
  type HouseholdMemberView,
  type HouseholdRole,
  type HouseholdStatusView,
  type HouseholdView,
} from '@zenfinance/shared';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';
import { assertPremium } from '../billing/service.js';
import { db } from '../db/client.js';
import {
  householdGoalContributions,
  householdGoals,
  householdInvites,
  householdMembers,
  households,
  users,
} from '../db/schema.js';
import { requireUser } from '../middleware/userAuth.js';
import { validateBody } from '../middleware/validate.js';

const HOUSEHOLD_SEAT_LIMIT = 2;
const INVITE_TTL_DAYS = 14;

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newInviteToken(): string {
  return `hh_${crypto.randomBytes(24).toString('base64url')}`;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function role(value: string): HouseholdRole {
  return value === 'owner' ? 'owner' : 'member';
}

function progress(current: number, target: number): number {
  return target > 0 ? Math.min(1, Number((current / target).toFixed(4))) : 0;
}

async function currentUser(userId: number): Promise<{ id: number; email: string } | null> {
  const [row] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return row ?? null;
}

async function membershipFor(userId: number): Promise<{ householdId: number; role: HouseholdRole } | null> {
  const [row] = await db
    .select({ householdId: householdMembers.householdId, role: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .limit(1);
  return row ? { householdId: row.householdId, role: role(row.role) } : null;
}

async function assertHouseholdMember(userId: number, householdId: number): Promise<{ role: HouseholdRole } | null> {
  const [row] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.userId, userId), eq(householdMembers.householdId, householdId)))
    .limit(1);
  return row ? { role: role(row.role) } : null;
}

async function memberCount(householdId: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(householdMembers).where(eq(householdMembers.householdId, householdId));
  return row?.n ?? 0;
}

async function pendingInviteCount(householdId: number): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(householdInvites)
    .where(and(eq(householdInvites.householdId, householdId), eq(householdInvites.status, 'pending'), sql`${householdInvites.expiresAt} > now()`));
  return row?.n ?? 0;
}

async function householdView(householdId: number, userId: number): Promise<HouseholdView> {
  const [household] = await db.select().from(households).where(eq(households.id, householdId)).limit(1);
  const [memberRows, inviteRows, goalRows] = await Promise.all([
    db
      .select({
        id: householdMembers.id,
        userId: householdMembers.userId,
        email: users.email,
        role: householdMembers.role,
        privacyMode: householdMembers.privacyMode,
        joinedAt: householdMembers.joinedAt,
      })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(eq(householdMembers.householdId, householdId))
      .orderBy(asc(householdMembers.joinedAt)),
    db
      .select()
      .from(householdInvites)
      .where(and(eq(householdInvites.householdId, householdId), eq(householdInvites.status, 'pending')))
      .orderBy(desc(householdInvites.createdAt)),
    db
      .select()
      .from(householdGoals)
      .where(eq(householdGoals.householdId, householdId))
      .orderBy(asc(householdGoals.priority), asc(householdGoals.id)),
  ]);
  const current = memberRows.find((member) => member.userId === userId);
  const goalIds = goalRows.map((goal) => goal.id);
  const contributionRows =
    goalIds.length === 0
      ? []
      : await db
          .select({
            id: householdGoalContributions.id,
            goalId: householdGoalContributions.goalId,
            userId: householdGoalContributions.userId,
            userEmail: users.email,
            amountCents: householdGoalContributions.amountCents,
            note: householdGoalContributions.note,
            contributedAt: householdGoalContributions.contributedAt,
          })
          .from(householdGoalContributions)
          .leftJoin(users, eq(users.id, householdGoalContributions.userId))
          .where(inArray(householdGoalContributions.goalId, goalIds))
          .orderBy(desc(householdGoalContributions.contributedAt), desc(householdGoalContributions.id));
  const contributionsByGoal = new Map<number, HouseholdGoalContributionView[]>();
  for (const contribution of contributionRows) {
    const list = contributionsByGoal.get(contribution.goalId) ?? [];
    list.push({
      id: contribution.id,
      userId: contribution.userId,
      userEmail: contribution.userEmail,
      amountCents: contribution.amountCents,
      note: contribution.note,
      contributedAt: contribution.contributedAt.toISOString(),
    });
    contributionsByGoal.set(contribution.goalId, list);
  }

  const members: HouseholdMemberView[] = memberRows.map((member) => ({
    id: member.id,
    userId: member.userId,
    email: member.email,
    role: role(member.role),
    privacyMode: 'individual',
    joinedAt: member.joinedAt.toISOString(),
  }));
  const invites: HouseholdInviteView[] = inviteRows.map((invite) => ({
    id: invite.id,
    email: invite.email,
    status: invite.expiresAt.getTime() <= Date.now() ? 'expired' : 'pending',
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
  }));

  return {
    id: household!.id,
    name: household!.name,
    seatLimit: household!.seatLimit,
    privacyMode: 'individual',
    currentUserRole: current ? role(current.role) : 'member',
    members,
    invites,
    goals: goalRows.map((goal) => ({
      id: goal.id,
      name: goal.name,
      targetAmountCents: goal.targetAmountCents,
      currentAmountCents: goal.currentAmountCents,
      targetDate: goal.targetDate,
      priority: goal.priority,
      status: goal.status,
      createdByUserId: goal.createdByUserId,
      progressRatio: progress(goal.currentAmountCents, goal.targetAmountCents),
      remainingAmountCents: Math.max(0, goal.targetAmountCents - goal.currentAmountCents),
      contributions: contributionsByGoal.get(goal.id) ?? [],
      createdAt: goal.createdAt.toISOString(),
      updatedAt: goal.updatedAt.toISOString(),
    })),
    createdAt: household!.createdAt.toISOString(),
    updatedAt: household!.updatedAt.toISOString(),
  };
}

async function householdStatus(userId: number): Promise<HouseholdStatusView> {
  const membership = await membershipFor(userId);
  if (!membership) return { household: null };
  return { household: await householdView(membership.householdId, userId) };
}

async function requireOwnedHousehold(userId: number): Promise<{ householdId: number } | null> {
  const membership = await membershipFor(userId);
  if (!membership || membership.role !== 'owner') return null;
  return { householdId: membership.householdId };
}

async function assertCapacity(householdId: number): Promise<boolean> {
  const [members, invites] = await Promise.all([memberCount(householdId), pendingInviteCount(householdId)]);
  return members + invites < HOUSEHOLD_SEAT_LIMIT;
}

export function createHouseholdsRouter(): ReturnType<typeof Router> {
  const router = Router();

  router.get('/api/household', requireUser, async (_req, res) => {
    res.json(await householdStatus(res.locals.userId as number));
  });

  router.post('/api/household', requireUser, validateBody(householdCreateSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    const premium = await assertPremium(db, userId, 'household_sharing');
    if (!premium.ok) {
      res.status(402).json(premium.payload);
      return;
    }
    if (await membershipFor(userId)) {
      res.status(409).json({ error: { code: 'household_exists', message: 'You are already in a household.' } });
      return;
    }
    const input = res.locals.body as HouseholdCreateInput;
    const [household] = await db
      .insert(households)
      .values({ name: input.name ?? 'Household', seatLimit: HOUSEHOLD_SEAT_LIMIT, createdByUserId: userId })
      .returning();
    await db.insert(householdMembers).values({ householdId: household!.id, userId, role: 'owner', privacyMode: 'individual' });
    res.status(201).json({ household: await householdView(household!.id, userId) });
  });

  router.post('/api/household/invites', requireUser, validateBody(householdInviteCreateSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    const premium = await assertPremium(db, userId, 'household_sharing');
    if (!premium.ok) {
      res.status(402).json(premium.payload);
      return;
    }
    const owned = await requireOwnedHousehold(userId);
    if (!owned) {
      res.status(403).json({ error: { code: 'forbidden', message: 'Only a household owner can invite a member.' } });
      return;
    }
    if (!(await assertCapacity(owned.householdId))) {
      res.status(400).json({ error: { code: 'household_full', message: 'Households include two seats at launch.' } });
      return;
    }
    const input = res.locals.body as HouseholdInviteCreateInput;
    const user = await currentUser(userId);
    if (input.email === user?.email) {
      res.status(400).json({ error: { code: 'invalid_invite', message: 'You cannot invite yourself.' } });
      return;
    }
    const existingMembers = await db
      .select({ email: users.email })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(eq(householdMembers.householdId, owned.householdId));
    if (existingMembers.some((member) => member.email === input.email)) {
      res.status(400).json({ error: { code: 'invalid_invite', message: 'That person is already in this household.' } });
      return;
    }

    await db
      .update(householdInvites)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(and(eq(householdInvites.householdId, owned.householdId), eq(householdInvites.email, input.email), eq(householdInvites.status, 'pending')));

    const acceptToken = newInviteToken();
    const [invite] = await db
      .insert(householdInvites)
      .values({
        householdId: owned.householdId,
        invitedByUserId: userId,
        email: input.email,
        tokenHash: tokenHash(acceptToken),
        expiresAt: addDays(new Date(), INVITE_TTL_DAYS),
      })
      .returning();
    const view: HouseholdInviteView = {
      id: invite!.id,
      email: invite!.email,
      status: 'pending',
      expiresAt: invite!.expiresAt.toISOString(),
      createdAt: invite!.createdAt.toISOString(),
    };
    const body: HouseholdInviteCreatedView = {
      invite: view,
      acceptToken,
      shareText: `Join my ZenFinance household with this invite code: ${acceptToken}`,
    };
    res.status(201).json(body);
  });

  router.post('/api/household/invites/accept', requireUser, validateBody(householdInviteAcceptSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    const input = res.locals.body as HouseholdInviteAcceptInput;
    if (await membershipFor(userId)) {
      res.status(409).json({ error: { code: 'household_exists', message: 'You are already in a household.' } });
      return;
    }
    const [invite] = await db
      .select()
      .from(householdInvites)
      .where(and(eq(householdInvites.tokenHash, tokenHash(input.token)), eq(householdInvites.status, 'pending')))
      .limit(1);
    if (!invite || invite.expiresAt.getTime() <= Date.now()) {
      if (invite) await db.update(householdInvites).set({ status: 'expired', updatedAt: new Date() }).where(eq(householdInvites.id, invite.id));
      res.status(404).json({ error: { code: 'invite_not_found', message: 'Household invite is invalid or expired.' } });
      return;
    }
    const user = await currentUser(userId);
    if (!user || user.email !== invite.email) {
      res.status(403).json({ error: { code: 'invite_email_mismatch', message: 'Sign in with the invited email to accept this household invite.' } });
      return;
    }
    if ((await memberCount(invite.householdId)) >= HOUSEHOLD_SEAT_LIMIT) {
      res.status(400).json({ error: { code: 'household_full', message: 'This household is already full.' } });
      return;
    }

    await db.insert(householdMembers).values({ householdId: invite.householdId, userId, role: 'member', privacyMode: 'individual' });
    await db
      .update(householdInvites)
      .set({ status: 'accepted', acceptedByUserId: userId, acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(householdInvites.id, invite.id));
    res.json({ household: await householdView(invite.householdId, userId) });
  });

  router.delete('/api/household/membership', requireUser, async (_req, res) => {
    const userId = res.locals.userId as number;
    const membership = await membershipFor(userId);
    if (!membership) {
      res.status(404).json({ error: { code: 'not_found', message: 'Household membership not found.' } });
      return;
    }
    const members = await memberCount(membership.householdId);
    if (membership.role === 'owner' && members > 1) {
      res.status(400).json({ error: { code: 'owner_required', message: 'Remove the other member before deleting this household.' } });
      return;
    }
    if (members <= 1) {
      await db.delete(households).where(eq(households.id, membership.householdId));
    } else {
      await db.delete(householdMembers).where(eq(householdMembers.userId, userId));
    }
    res.json({ ok: true });
  });

  router.post('/api/household/goals', requireUser, validateBody(householdGoalCreateSchema), async (_req, res) => {
    const userId = res.locals.userId as number;
    const membership = await membershipFor(userId);
    if (!membership) {
      res.status(404).json({ error: { code: 'not_found', message: 'Create or join a household first.' } });
      return;
    }
    const input = res.locals.body as HouseholdGoalCreateInput;
    const [goal] = await db
      .insert(householdGoals)
      .values({
        householdId: membership.householdId,
        createdByUserId: userId,
        name: input.name,
        targetAmountCents: input.targetAmountCents,
        currentAmountCents: input.currentAmountCents ?? 0,
        targetDate: input.targetDate ?? null,
        priority: input.priority ?? 1,
      })
      .returning();
    res.status(201).json({ household: await householdView(goal!.householdId, userId) });
  });

  router.patch('/api/household/goals/:id', requireUser, validateBody(householdGoalUpdateSchema), async (req, res) => {
    const userId = res.locals.userId as number;
    const membership = await membershipFor(userId);
    if (!membership) {
      res.status(404).json({ error: { code: 'not_found', message: 'Household membership not found.' } });
      return;
    }
    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(householdGoals)
      .where(and(eq(householdGoals.id, id), eq(householdGoals.householdId, membership.householdId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: { code: 'not_found', message: 'Shared goal not found.' } });
      return;
    }
    const input = res.locals.body as HouseholdGoalUpdateInput;
    await db
      .update(householdGoals)
      .set({
        name: input.name ?? existing.name,
        targetAmountCents: input.targetAmountCents ?? existing.targetAmountCents,
        currentAmountCents: input.currentAmountCents ?? existing.currentAmountCents,
        targetDate: input.targetDate === undefined ? existing.targetDate : input.targetDate,
        priority: input.priority ?? existing.priority,
        status: input.status ?? existing.status,
        updatedAt: new Date(),
      })
      .where(eq(householdGoals.id, existing.id));
    res.json({ household: await householdView(existing.householdId, userId) });
  });

  router.post('/api/household/goals/:id/contributions', requireUser, validateBody(householdGoalContributionSchema), async (req, res) => {
    const userId = res.locals.userId as number;
    const membership = await membershipFor(userId);
    if (!membership) {
      res.status(404).json({ error: { code: 'not_found', message: 'Household membership not found.' } });
      return;
    }
    const id = Number(req.params.id);
    const [goal] = await db
      .select()
      .from(householdGoals)
      .where(and(eq(householdGoals.id, id), eq(householdGoals.householdId, membership.householdId)))
      .limit(1);
    if (!goal) {
      res.status(404).json({ error: { code: 'not_found', message: 'Shared goal not found.' } });
      return;
    }
    const input = res.locals.body as HouseholdGoalContributionInput;
    await db.insert(householdGoalContributions).values({
      goalId: goal.id,
      userId,
      amountCents: input.amountCents,
      note: input.note ?? null,
    });
    await db
      .update(householdGoals)
      .set({ currentAmountCents: sql`${householdGoals.currentAmountCents} + ${input.amountCents}`, updatedAt: new Date() })
      .where(eq(householdGoals.id, goal.id));
    res.status(201).json({ household: await householdView(goal.householdId, userId) });
  });

  router.delete('/api/household/goals/:id', requireUser, async (req, res) => {
    const userId = res.locals.userId as number;
    const membership = await membershipFor(userId);
    if (!membership) {
      res.status(404).json({ error: { code: 'not_found', message: 'Household membership not found.' } });
      return;
    }
    const id = Number(req.params.id);
    const [goal] = await db
      .select({ id: householdGoals.id })
      .from(householdGoals)
      .where(and(eq(householdGoals.id, id), eq(householdGoals.householdId, membership.householdId)))
      .limit(1);
    if (!goal) {
      res.status(404).json({ error: { code: 'not_found', message: 'Shared goal not found.' } });
      return;
    }
    await db.delete(householdGoals).where(eq(householdGoals.id, goal.id));
    res.json({ household: await householdView(membership.householdId, userId) });
  });

  return router;
}
