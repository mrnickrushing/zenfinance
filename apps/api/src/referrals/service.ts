import crypto from 'node:crypto';
import type { ReferralCreditView, ReferralStatusView } from '@zenfinance/shared';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { referralCodes, referralCredits, referralRedemptions, users } from '../db/schema.js';
import { env } from '../env.js';

const CREDIT_DAYS = 30;

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

function publicBaseUrl(): string {
  return env.FRONTEND_URL.replace(/\/$/, '');
}

function creditView(row: typeof referralCredits.$inferSelect): ReferralCreditView {
  return {
    id: row.id,
    days: row.days,
    status: 'applied',
    appliedAt: row.appliedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

async function activeReferralExpiry(db: Db, userId: number, now = new Date()): Promise<Date | null> {
  const [row] = await db
    .select({ expiresAt: referralCredits.expiresAt })
    .from(referralCredits)
    .where(and(eq(referralCredits.recipientUserId, userId), eq(referralCredits.status, 'applied'), gt(referralCredits.expiresAt, now)))
    .orderBy(desc(referralCredits.expiresAt))
    .limit(1);
  return row?.expiresAt ?? null;
}

async function nextCreditExpiry(db: Db, userId: number, days: number, now = new Date()): Promise<Date> {
  const activeUntil = await activeReferralExpiry(db, userId, now);
  const start = activeUntil && activeUntil.getTime() > now.getTime() ? activeUntil : now;
  return addDays(start, days);
}

async function generateUniqueCode(db: Db): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = `ZF${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const [existing] = await db.select({ code: referralCodes.code }).from(referralCodes).where(eq(referralCodes.code, code)).limit(1);
    if (!existing) return code;
  }
  throw new Error('Unable to generate referral code');
}

export async function getActiveReferralCreditExpiry(db: Db, userId: number): Promise<Date | null> {
  return activeReferralExpiry(db, userId);
}

export async function getOrCreateReferralCode(db: Db, userId: number): Promise<string> {
  const [existing] = await db.select().from(referralCodes).where(eq(referralCodes.userId, userId)).limit(1);
  if (existing) return existing.code;
  const code = await generateUniqueCode(db);
  const [created] = await db
    .insert(referralCodes)
    .values({ userId, code })
    .onConflictDoNothing({ target: referralCodes.userId })
    .returning({ code: referralCodes.code });
  if (created) return created.code;
  const [afterRace] = await db.select().from(referralCodes).where(eq(referralCodes.userId, userId)).limit(1);
  return afterRace!.code;
}

export async function getReferralStatus(db: Db, userId: number): Promise<ReferralStatusView> {
  const code = await getOrCreateReferralCode(db, userId);
  const shareUrl = `${publicBaseUrl()}/?ref=${encodeURIComponent(code)}#waitlist`;
  const [redemptionCount] = await db
    .select({ n: sql<number>`count(*)` })
    .from(referralRedemptions)
    .where(eq(referralRedemptions.referrerUserId, userId));
  const [creditSummary] = await db
    .select({
      n: sql<number>`count(*)`,
      days: sql<number>`coalesce(sum(${referralCredits.days}), 0)`,
    })
    .from(referralCredits)
    .where(eq(referralCredits.recipientUserId, userId));
  const [redeemed] = await db
    .select({ code: referralRedemptions.code })
    .from(referralRedemptions)
    .where(eq(referralRedemptions.referredUserId, userId))
    .limit(1);
  const credits = await db
    .select()
    .from(referralCredits)
    .where(eq(referralCredits.recipientUserId, userId))
    .orderBy(desc(referralCredits.expiresAt));
  const activeCreditExpiresAt = await activeReferralExpiry(db, userId);

  return {
    code,
    shareUrl,
    shareText: `Join ZenFinance with my code ${code} and we both get 30 days of ZenFinance Coach: ${shareUrl}`,
    referredUsers: Number(redemptionCount?.n ?? 0),
    creditsAwarded: Number(creditSummary?.n ?? 0),
    premiumDaysAwarded: Number(creditSummary?.days ?? 0),
    activeCreditExpiresAt: activeCreditExpiresAt ? activeCreditExpiresAt.toISOString() : null,
    redeemedCode: redeemed?.code ?? null,
    credits: credits.map(creditView),
  };
}

export async function redeemReferralCode(db: Db, referredUserId: number, rawCode: string): Promise<ReferralStatusView> {
  const code = normalizeCode(rawCode);
  const [referral] = await db
    .select({
      userId: referralCodes.userId,
      code: referralCodes.code,
      email: users.email,
    })
    .from(referralCodes)
    .innerJoin(users, eq(users.id, referralCodes.userId))
    .where(eq(referralCodes.code, code))
    .limit(1);
  if (!referral) throw new Error('Referral code not found');
  if (referral.userId === referredUserId) throw new Error('You cannot redeem your own referral code');

  const [existing] = await db
    .select({ id: referralRedemptions.id })
    .from(referralRedemptions)
    .where(eq(referralRedemptions.referredUserId, referredUserId))
    .limit(1);
  if (existing) throw new Error('This account has already redeemed a referral code');

  const now = new Date();
  const [redemption] = await db
    .insert(referralRedemptions)
    .values({
      codeId: referral.userId,
      referrerUserId: referral.userId,
      referredUserId,
      code,
      createdAt: now,
    })
    .returning({ id: referralRedemptions.id });

  const referredExpiresAt = await nextCreditExpiry(db, referredUserId, CREDIT_DAYS, now);
  const referrerExpiresAt = await nextCreditExpiry(db, referral.userId, CREDIT_DAYS, now);
  await db.insert(referralCredits).values([
    {
      redemptionId: redemption!.id,
      recipientUserId: referredUserId,
      sourceUserId: referral.userId,
      days: CREDIT_DAYS,
      appliedAt: now,
      expiresAt: referredExpiresAt,
    },
    {
      redemptionId: redemption!.id,
      recipientUserId: referral.userId,
      sourceUserId: referredUserId,
      days: CREDIT_DAYS,
      appliedAt: now,
      expiresAt: referrerExpiresAt,
    },
  ]);

  return getReferralStatus(db, referredUserId);
}
