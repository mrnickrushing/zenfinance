import crypto from 'node:crypto';
import {
  ANNUAL_PRODUCT_ID,
  MONEY_PHYSICAL_PRODUCT_ID,
  MONTHLY_PRODUCT_ID,
  type BillingEntitlementView,
  type BillingLimitsView,
  type BillingPlan,
  type BillingRestoreInput,
  type BillingStatus,
  type BillingStatusView,
  type PaywallPackageView,
  type PricingExperimentView,
} from '@zenfinance/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  billingCustomers,
  billingEntitlements,
  billingEvents,
  pricingExperiments,
  users,
} from '../db/schema.js';
import { env } from '../env.js';
import { recordMoneyPhysicalPurchase } from '../moneyPhysical/service.js';
import { getActiveReferralCreditExpiry } from '../referrals/service.js';

export const PREMIUM_STATUSES = new Set<BillingStatus>(['trialing', 'active', 'grace_period']);
export const FREE_LIMITS: BillingLimitsView = {
  maxLinkedItems: 2,
  maxActiveGoals: 1,
  weeklyBriefsOnly: true,
  premiumFeatures: false,
};
export const PREMIUM_LIMITS: BillingLimitsView = {
  maxLinkedItems: null,
  maxActiveGoals: null,
  weeklyBriefsOnly: false,
  premiumFeatures: true,
};

interface RevenueCatWebhookEvent {
  id?: string;
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  entitlement_id?: string | null;
  entitlement_ids?: string[];
  product_id?: string;
  new_product_id?: string;
  store?: string;
  environment?: 'SANDBOX' | 'PRODUCTION';
  event_timestamp_ms?: number;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  grace_period_expiration_at_ms?: number | null;
  cancel_reason?: string | null;
  expiration_reason?: string | null;
  auto_resume_at_ms?: number | null;
  price?: number;
  currency?: string;
  transaction_id?: string;
  original_transaction_id?: string;
}

interface RevenueCatWebhookBody {
  api_version?: string;
  event?: RevenueCatWebhookEvent;
}

interface RevenueCatRestEntitlement {
  expires_date?: string | null;
  grace_period_expires_date?: string | null;
  product_identifier?: string | null;
  purchase_date?: string | null;
}

export function appUserIdFor(userId: number): string {
  return `zenfinance:${userId}`;
}

export function userIdFromAppUserId(appUserId: string | undefined | null): number | null {
  const match = appUserId?.match(/^zenfinance:(\d+)$/);
  if (!match) return null;
  return Number(match[1]);
}

function dateFromMs(ms?: number | null): Date | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms) : null;
}

function dateFromIso(value?: string | null): Date | null {
  return value ? new Date(value) : null;
}

function dateToIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function planForProduct(productId: string | null | undefined): Exclude<BillingPlan, 'referral'> {
  if (!productId) return 'unknown';
  if (productId === env.REVENUECAT_MONTHLY_PRODUCT_ID || productId === MONTHLY_PRODUCT_ID) return 'monthly';
  if (productId === env.REVENUECAT_ANNUAL_PRODUCT_ID || productId === ANNUAL_PRODUCT_ID) return 'annual';
  if (/annual|year/i.test(productId)) return 'annual';
  if (/month/i.test(productId)) return 'monthly';
  if (/lifetime/i.test(productId)) return 'lifetime';
  return 'unknown';
}

function isPremium(status: BillingStatus, expiresAt: Date | null): boolean {
  if (!PREMIUM_STATUSES.has(status)) return false;
  return !expiresAt || expiresAt.getTime() > Date.now();
}

function statusFromRestore(input: BillingRestoreInput): BillingStatus {
  if (!input.active) return 'expired';
  const exp = dateFromIso(input.expirationDate ?? null);
  if (exp && exp.getTime() <= Date.now()) return 'expired';
  return 'active';
}

function statusFromWebhook(event: RevenueCatWebhookEvent): BillingStatus {
  const exp = dateFromMs(event.expiration_at_ms ?? null);
  const grace = dateFromMs(event.grace_period_expiration_at_ms ?? null);
  switch (event.type) {
    case 'INITIAL_PURCHASE':
      return event.product_id && /trial/i.test(String((event as { period_type?: string }).period_type ?? '')) ? 'trialing' : 'active';
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
    case 'SUBSCRIPTION_EXTENDED':
    case 'REFUND_REVERSED':
      return 'active';
    case 'TEMPORARY_ENTITLEMENT_GRANT':
      return 'grace_period';
    case 'BILLING_ISSUE':
      return grace && grace.getTime() > Date.now() ? 'grace_period' : 'billing_issue';
    case 'CANCELLATION':
      if (event.cancel_reason === 'CUSTOMER_SUPPORT') return 'refunded';
      if (event.cancel_reason === 'BILLING_ERROR') return grace && grace.getTime() > Date.now() ? 'grace_period' : 'billing_issue';
      return exp && exp.getTime() > Date.now() ? 'active' : 'expired';
    case 'EXPIRATION':
    case 'SUBSCRIPTION_PAUSED':
      return 'expired';
    default:
      return exp && exp.getTime() > Date.now() ? 'active' : 'expired';
  }
}

function pricingVariantFor(userId: number): 'control' | 'money_wins' {
  return userId % 2 === 0 ? 'money_wins' : 'control';
}

function pricingCopy(variant: 'control' | 'money_wins'): Pick<PricingExperimentView, 'paywallHeadline' | 'paywallBody'> {
  if (variant === 'money_wins') {
    return {
      paywallHeadline: 'Let the coach pay for itself',
      paywallBody:
        'ZenFinance Coach unlocks the chat coach, what-if planning, subscription audits, and Money Wins tracking for $7.99/month or $59.99/year after the trial.',
    };
  }
  return {
    paywallHeadline: 'Unlock ZenFinance Coach',
    paywallBody:
      'Get unlimited accounts, more goals, on-demand coaching, what-if planning, subscription audits, and the full Money Wins ledger.',
  };
}

export async function getOrCreateBillingCustomer(db: Db, userId: number): Promise<string> {
  const [existing] = await db
    .select({ appUserId: billingCustomers.revenueCatAppUserId })
    .from(billingCustomers)
    .where(eq(billingCustomers.userId, userId))
    .limit(1);
  if (existing) return existing.appUserId;

  const appUserId = appUserIdFor(userId);
  await db
    .insert(billingCustomers)
    .values({ userId, revenueCatAppUserId: appUserId })
    .onConflictDoNothing({ target: billingCustomers.userId });
  return appUserId;
}

export async function getOrCreatePricingExperiment(db: Db, userId: number): Promise<PricingExperimentView> {
  const [existing] = await db
    .select()
    .from(pricingExperiments)
    .where(eq(pricingExperiments.userId, userId))
    .limit(1);
  if (existing) {
    const variant = existing.variant === 'money_wins' ? 'money_wins' : 'control';
    return {
      experimentId: existing.experimentId,
      variant,
      ...pricingCopy(variant),
      assignedAt: existing.assignedAt.toISOString(),
    };
  }

  const variant = pricingVariantFor(userId);
  const [created] = await db
    .insert(pricingExperiments)
    .values({ userId, experimentId: 'paywall_money_wins_v1', variant })
    .returning();
  return {
    experimentId: created!.experimentId,
    variant,
    ...pricingCopy(variant),
    assignedAt: created!.assignedAt.toISOString(),
  };
}

export function paywallPackages(): PaywallPackageView[] {
  return [
    {
      identifier: 'monthly',
      productId: env.REVENUECAT_MONTHLY_PRODUCT_ID,
      priceLabel: '$7.99/mo',
      introTrialDays: 14,
      savingsLabel: null,
    },
    {
      identifier: 'annual',
      productId: env.REVENUECAT_ANNUAL_PRODUCT_ID,
      priceLabel: '$59.99/yr',
      introTrialDays: 14,
      savingsLabel: 'Save 37%',
    },
  ];
}

function entitlementToView(row: typeof billingEntitlements.$inferSelect): BillingEntitlementView {
  return {
    entitlementId: row.entitlementId,
    status: row.status,
    plan: row.plan,
    productId: row.productId,
    store: row.store,
    environment: row.environment === 'SANDBOX' || row.environment === 'PRODUCTION' ? row.environment : 'UNKNOWN',
    willRenew: row.willRenew,
    expiresAt: dateToIso(row.expiresAt),
    latestPurchaseAt: dateToIso(row.latestPurchaseAt),
    billingIssueAt: dateToIso(row.billingIssueAt),
    cancellationAt: dateToIso(row.cancellationAt),
    managementUrl: row.managementUrl,
    source: row.source,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getBillingStatus(db: Db, userId: number): Promise<BillingStatusView> {
  const appUserId = await getOrCreateBillingCustomer(db, userId);
  const [[entitlement], referralExpiresAt] = await Promise.all([
    db
      .select()
      .from(billingEntitlements)
      .where(and(eq(billingEntitlements.userId, userId), eq(billingEntitlements.entitlementId, env.REVENUECAT_ENTITLEMENT_ID)))
      .limit(1),
    getActiveReferralCreditExpiry(db, userId),
  ]);
  const status = entitlement?.status ?? 'free';
  const storePremium = entitlement ? isPremium(status, entitlement.expiresAt) : false;
  const referralPremium = Boolean(referralExpiresAt && referralExpiresAt.getTime() > Date.now());
  const premium = storePremium || referralPremium;
  const referralEntitlement: BillingEntitlementView | null = referralPremium
    ? {
        entitlementId: env.REVENUECAT_ENTITLEMENT_ID,
        status: 'active',
        plan: 'referral',
        productId: null,
        store: null,
        environment: 'UNKNOWN',
        willRenew: false,
        expiresAt: dateToIso(referralExpiresAt),
        latestPurchaseAt: null,
        billingIssueAt: null,
        cancellationAt: null,
        managementUrl: null,
        source: 'referral_credit',
        updatedAt: new Date().toISOString(),
      }
    : null;
  return {
    appUserId,
    entitlementId: env.REVENUECAT_ENTITLEMENT_ID,
    isPremium: premium,
    status: storePremium ? status : referralPremium ? 'active' : status === 'free' ? 'free' : status,
    plan: storePremium ? (entitlement?.plan ?? 'unknown') : referralPremium ? 'referral' : (entitlement?.plan ?? 'free'),
    limits: premium ? PREMIUM_LIMITS : FREE_LIMITS,
    entitlement: storePremium && entitlement ? entitlementToView(entitlement) : referralEntitlement ?? (entitlement ? entitlementToView(entitlement) : null),
    packages: paywallPackages(),
    pricingExperiment: await getOrCreatePricingExperiment(db, userId),
  };
}

export async function userHasPremium(db: Db, userId: number): Promise<boolean> {
  return (await getBillingStatus(db, userId)).isPremium;
}

export function premiumRequiredPayload(feature: string): { error: { code: string; message: string; details: { feature: string } } } {
  return {
    error: {
      code: 'premium_required',
      message: 'ZenFinance Coach is required for this feature.',
      details: { feature },
    },
  };
}

export async function assertPremium(db: Db, userId: number, feature: string): Promise<{ ok: true } | { ok: false; payload: ReturnType<typeof premiumRequiredPayload> }> {
  if (await userHasPremium(db, userId)) return { ok: true };
  return { ok: false, payload: premiumRequiredPayload(feature) };
}

export async function upsertEntitlement(
  db: Db,
  userId: number,
  input: {
    entitlementId: string;
    status: BillingStatus;
    plan: Exclude<BillingPlan, 'referral'>;
    productId: string | null;
    store: string | null;
    environment: string;
    willRenew: boolean | null;
    expiresAt: Date | null;
    latestPurchaseAt: Date | null;
    billingIssueAt: Date | null;
    cancellationAt: Date | null;
    managementUrl: string | null;
    source: 'revenuecat_webhook' | 'revenuecat_rest' | 'client_restore' | 'manual_test';
    sourceEventId: string | null;
    sourceEventAt?: Date | null;
    rawPayload: unknown;
  },
): Promise<void> {
  const now = new Date();
  const values = { userId, ...input, sourceEventAt: input.sourceEventAt ?? null, updatedAt: now };
  const conflict = db
    .insert(billingEntitlements)
    .values(values)
    .onConflictDoUpdate({
      target: [billingEntitlements.userId, billingEntitlements.entitlementId],
      set: { ...input, sourceEventAt: input.sourceEventAt ?? null, updatedAt: now },
      where:
        input.source === 'revenuecat_webhook' && input.sourceEventAt
          ? sql`${billingEntitlements.sourceEventAt} is null or ${billingEntitlements.sourceEventAt} <= ${input.sourceEventAt}`
          : undefined,
    });
  await conflict;
}

export function verifyRevenueCatSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.REVENUECAT_WEBHOOK_SIGNING_SECRET) return env.NODE_ENV !== 'production';
  if (!signatureHeader) return false;
  const parts = new Map(signatureHeader.split(',').map((part) => {
    const [key, value] = part.split('=');
    return [key?.trim(), value?.trim()];
  }));
  const timestamp = parts.get('t');
  const signature = parts.get('v1');
  if (!timestamp || !signature) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;
  const expected = crypto
    .createHmac('sha256', env.REVENUECAT_WEBHOOK_SIGNING_SECRET)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  if (expected.length !== signature.length) return false;
  const expectedBuffer = Buffer.from(expected, 'hex');
  const signatureBuffer = Buffer.from(signature, 'hex');
  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function verifyRevenueCatAuthorization(header: string | undefined): boolean {
  if (!env.REVENUECAT_WEBHOOK_AUTH) return env.NODE_ENV !== 'production';
  return header === env.REVENUECAT_WEBHOOK_AUTH || header === `Bearer ${env.REVENUECAT_WEBHOOK_AUTH}`;
}

function revenueCatAppUserIds(event: RevenueCatWebhookEvent): string[] {
  return [...new Set([event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])].filter((value): value is string => Boolean(value)))];
}

async function resolveRevenueCatUser(db: Db, event: RevenueCatWebhookEvent): Promise<{ userId: number | null; appUserId: string }> {
  const appUserIds = revenueCatAppUserIds(event);
  if (appUserIds.length === 0) throw new Error('RevenueCat webhook missing app_user_id');

  const customers = await db
    .select({ userId: billingCustomers.userId, appUserId: billingCustomers.revenueCatAppUserId })
    .from(billingCustomers)
    .where(inArray(billingCustomers.revenueCatAppUserId, appUserIds));
  const userIds = [...new Set(customers.map((customer) => customer.userId))];
  if (userIds.length > 1) throw new Error('RevenueCat webhook aliases map to multiple users');
  if (customers[0]) return { userId: customers[0].userId, appUserId: customers[0].appUserId };

  const parsedUserId = appUserIds.map(userIdFromAppUserId).find((value): value is number => value !== null) ?? null;
  if (parsedUserId) {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, parsedUserId)).limit(1);
    if (!user) throw new Error(`RevenueCat app_user_id does not map to an existing user: ${appUserIdFor(parsedUserId)}`);
    const appUserId = await getOrCreateBillingCustomer(db, parsedUserId);
    return { userId: parsedUserId, appUserId };
  }

  return { userId: null, appUserId: appUserIds[0]! };
}

export async function processRevenueCatWebhook(db: Db, body: RevenueCatWebhookBody): Promise<{ ok: true; duplicate: boolean; userId: number | null }> {
  const event = body.event;
  if (!event?.id || !event.type) throw new Error('RevenueCat webhook missing event.id or event.type');
  const eventId = event.id;
  const eventType = event.type;
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    const { userId, appUserId } = await resolveRevenueCatUser(txDb, event);
    const eventTime = dateFromMs(event.event_timestamp_ms ?? null) ?? new Date();
    const entitlementIds = event.entitlement_ids ?? (event.entitlement_id ? [event.entitlement_id] : []);
    const productId = event.new_product_id ?? event.product_id ?? null;

    const [inserted] = await tx
      .insert(billingEvents)
      .values({
        revenueCatEventId: eventId,
        userId,
        appUserId,
        type: eventType,
        productId,
        entitlementIds,
        environment: event.environment ?? 'UNKNOWN',
        eventTimestamp: eventTime,
        rawPayload: body,
      })
      .onConflictDoNothing({ target: billingEvents.revenueCatEventId })
      .returning({ id: billingEvents.id });
    if (!inserted) return { ok: true, duplicate: true, userId };

    if (userId && entitlementIds.includes(env.REVENUECAT_ENTITLEMENT_ID)) {
      const status = statusFromWebhook(event);
      await upsertEntitlement(txDb, userId, {
        entitlementId: env.REVENUECAT_ENTITLEMENT_ID,
        status,
        plan: status === 'expired' || status === 'refunded' ? 'free' : planForProduct(productId),
        productId,
        store: event.store ?? null,
        environment: event.environment ?? 'UNKNOWN',
        willRenew:
          event.type === 'CANCELLATION' || event.type === 'EXPIRATION' || event.type === 'SUBSCRIPTION_PAUSED'
            ? false
            : status === 'active' || status === 'trialing' || status === 'grace_period'
              ? true
              : null,
        expiresAt: dateFromMs(event.grace_period_expiration_at_ms ?? event.expiration_at_ms ?? null),
        latestPurchaseAt: dateFromMs(event.purchased_at_ms ?? null),
        billingIssueAt: event.type === 'BILLING_ISSUE' || event.cancel_reason === 'BILLING_ERROR' ? eventTime : null,
        cancellationAt: event.type === 'CANCELLATION' ? eventTime : null,
        managementUrl: null,
        source: 'revenuecat_webhook',
        sourceEventId: eventId,
        sourceEventAt: eventTime,
        rawPayload: body,
      });
    }
    if (userId && productId === MONEY_PHYSICAL_PRODUCT_ID) {
      await recordMoneyPhysicalPurchase(
        txDb,
        userId,
        {
          productId,
          transactionId: event.transaction_id ?? event.original_transaction_id ?? eventId,
          store: event.store ?? null,
          environment: event.environment ?? 'UNKNOWN',
          purchasedAt: dateFromMs(event.purchased_at_ms ?? event.event_timestamp_ms ?? null) ?? new Date(),
          purchaseSource: 'revenuecat_webhook',
          rawPayload: body,
        },
        'revenuecat_webhook',
        body,
      );
    }
    return { ok: true, duplicate: false, userId };
  });
}

export async function syncFromRevenueCatRest(db: Db, userId: number): Promise<void> {
  if (!env.REVENUECAT_SECRET_API_KEY) return;
  const appUserId = await getOrCreateBillingCustomer(db, userId);
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: {
      Authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`RevenueCat subscriber refresh failed (${res.status})`);
  }
  const body = (await res.json()) as {
    subscriber?: {
      entitlements?: Record<string, RevenueCatRestEntitlement>;
      management_url?: string | null;
      subscriptions?: Record<string, { store?: string; unsubscribe_detected_at?: string | null }>;
    };
  };
  const entitlement = body.subscriber?.entitlements?.[env.REVENUECAT_ENTITLEMENT_ID];
  if (!entitlement) {
    await upsertEntitlement(db, userId, {
      entitlementId: env.REVENUECAT_ENTITLEMENT_ID,
      status: 'free',
      plan: 'free',
      productId: null,
      store: null,
      environment: 'UNKNOWN',
      willRenew: null,
      expiresAt: null,
      latestPurchaseAt: null,
      billingIssueAt: null,
      cancellationAt: null,
      managementUrl: body.subscriber?.management_url ?? null,
      source: 'revenuecat_rest',
      sourceEventId: null,
      rawPayload: body,
    });
    return;
  }
  const productId = entitlement.product_identifier ?? null;
  const expiresAt = dateFromIso(entitlement.grace_period_expires_date ?? entitlement.expires_date ?? null);
  await upsertEntitlement(db, userId, {
    entitlementId: env.REVENUECAT_ENTITLEMENT_ID,
    status: expiresAt && expiresAt.getTime() <= Date.now() ? 'expired' : 'active',
    plan: planForProduct(productId),
    productId,
    store: productId ? (body.subscriber?.subscriptions?.[productId]?.store ?? null) : null,
    environment: 'UNKNOWN',
    willRenew: productId ? !body.subscriber?.subscriptions?.[productId]?.unsubscribe_detected_at : null,
    expiresAt,
    latestPurchaseAt: dateFromIso(entitlement.purchase_date ?? null),
    billingIssueAt: null,
    cancellationAt: productId ? dateFromIso(body.subscriber?.subscriptions?.[productId]?.unsubscribe_detected_at ?? null) : null,
    managementUrl: body.subscriber?.management_url ?? null,
    source: 'revenuecat_rest',
    sourceEventId: null,
    rawPayload: body,
  });
}

export async function applyClientRestore(db: Db, userId: number, input: BillingRestoreInput): Promise<void> {
  const appUserId = await getOrCreateBillingCustomer(db, userId);
  if (input.appUserId !== appUserId) throw new Error('RevenueCat appUserId does not match authenticated user');
  if (env.NODE_ENV === 'production' && input.active && !env.REVENUECAT_SECRET_API_KEY) {
    throw new Error('REVENUECAT_SECRET_API_KEY is required to validate active restores in production');
  }
  if (env.REVENUECAT_SECRET_API_KEY) {
    await syncFromRevenueCatRest(db, userId);
    return;
  }
  const status = statusFromRestore(input);
  await upsertEntitlement(db, userId, {
    entitlementId: input.entitlementId,
    status,
    plan: status === 'expired' ? 'free' : planForProduct(input.productId),
    productId: input.productId ?? null,
    store: input.store ?? null,
    environment: input.environment,
    willRenew: input.willRenew ?? null,
    expiresAt: dateFromIso(input.expirationDate ?? null),
    latestPurchaseAt: dateFromIso(input.latestPurchaseDate ?? null),
    billingIssueAt: null,
    cancellationAt: null,
    managementUrl: input.managementUrl ?? null,
    source: 'client_restore',
    sourceEventId: null,
    rawPayload: input,
  });
}
