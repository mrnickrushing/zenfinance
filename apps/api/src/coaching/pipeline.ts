import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { insights, items, users } from '../db/schema.js';
import { recordAiUsage } from '../enrichment/cost.js';
import { computeRecentRollups } from '../features/rollup.js';
import { sendPushToUser } from '../lib/push.js';
import { safeErrorSummary } from '../lib/safeError.js';
import { detectAnomalies } from './anomalies.js';
import { assembleCoachingContext } from './derive.js';
import { recordSpendReductionWins, verifyMoneyWins } from './moneyWins.js';
import { checkProvenance } from './provenance.js';
import { generateTemplateBrief } from './template.js';
import { checkTone } from './toneRules.js';
import type { BriefDraft, CoachingContext, InsightProvider } from './types.js';

const MAX_MODEL_ATTEMPTS = 2; // §4: retry once, then fall back to template

interface StoredInsight {
  id: number;
  kind: 'first_look' | 'weekly_brief';
  source: 'llm' | 'template';
}

function validateDraft(draft: BriefDraft, context: CoachingContext): { ok: boolean; reason: string | null } {
  if (!draft.action.description.trim()) return { ok: false, reason: 'action has no description' };
  const provenance = checkProvenance(draft.claims, context.facts);
  if (!provenance.ok) return provenance;
  const tone = checkTone(draft);
  if (!tone.ok) return tone;
  return { ok: true, reason: null };
}

async function persistBrief(
  db: Db,
  userId: number,
  context: CoachingContext,
  draft: BriefDraft,
  source: 'llm' | 'template',
  model: string | null,
): Promise<StoredInsight> {
  // first_look pins to the latest week so re-runs upsert instead of duplicating
  // (a null weekStart would defeat the unique index — NULLs are distinct).
  const weekStart = context.weekStart;
  const [row] = await db
    .insert(insights)
    .values({
      userId,
      kind: context.kind,
      weekStart,
      headline: draft.headline,
      body: draft.body,
      actionDescription: draft.action.description,
      actionEstimatedImpactCents: draft.action.estimatedImpactCents,
      actionTimeframe: draft.action.timeframe,
      claims: draft.claims,
      toneCheck: draft.toneCheck,
      source,
      model,
    })
    .onConflictDoUpdate({
      target: [insights.userId, insights.kind, insights.weekStart],
      set: {
        headline: draft.headline,
        body: draft.body,
        actionDescription: draft.action.description,
        actionEstimatedImpactCents: draft.action.estimatedImpactCents,
        actionTimeframe: draft.action.timeframe,
        claims: draft.claims,
        toneCheck: draft.toneCheck,
        source,
        model,
        // reset feedback when regenerated
        feedbackRating: null,
        feedbackFollowedThrough: null,
        createdAt: new Date(),
      },
    })
    .returning({ id: insights.id });
  return { id: row!.id, kind: context.kind, source };
}

/**
 * Generate one coaching brief with the §4 guard chain: model attempt →
 * provenance + tone validation → retry once on failure → deterministic
 * template fallback. Returns null only when there's nothing to say (no facts).
 */
export async function generateAndStoreBrief(
  db: Db,
  provider: InsightProvider,
  userId: number,
  kind: 'first_look' | 'weekly_brief',
): Promise<StoredInsight | null> {
  const context = await assembleCoachingContext(db, userId, kind);
  if (context.facts.length === 0) return null; // no data yet — say nothing rather than fabricate

  for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt++) {
    try {
      const { draft, usage } = await provider.generateBrief(context);
      const validation = validateDraft(draft, context);
      if (usage) {
        await recordAiUsage(db, {
          userId,
          purpose: 'brief',
          model: provider.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
      }
      if (validation.ok) {
        return await persistBrief(db, userId, context, draft, 'llm', provider.model);
      }
      console.warn(`[coaching] brief attempt ${attempt + 1} failed guard: ${validation.reason}`);
    } catch (err) {
      console.error(`[coaching] brief attempt ${attempt + 1} threw:`, safeErrorSummary(err));
    }
  }

  // Fallback to the deterministic template.
  const template = generateTemplateBrief(context);
  if (!template) return null;
  return await persistBrief(db, userId, context, template, 'template', null);
}

/**
 * The first-look brief (PLAN §3: "deliver value in week 1 of any user's
 * life"). Runs once, right after the 90-day backfill enriches: computes the
 * backfill's rollups, detects anomalies, then generates the brief. A no-op if
 * the user already has a first-look.
 */
export async function runFirstLookForUser(db: Db, provider: InsightProvider, userId: number): Promise<void> {
  const [existing] = await db
    .select({ id: insights.id })
    .from(insights)
    .where(and(eq(insights.userId, userId), eq(insights.kind, 'first_look')))
    .limit(1);
  if (existing) return;

  await computeRecentRollups(db, userId, 12);
  await detectAnomalies(db, userId);
  const stored = await generateAndStoreBrief(db, provider, userId, 'first_look');
  if (stored) {
    await sendPushToUser(db, userId, {
      title: 'Your first look is ready',
      body: 'Tap to see your first ZenFinance money brief.',
      data: { tab: 'brief' },
    });
  }
}

/**
 * The weekly brief pass: refresh anomalies, advance money-win verification,
 * record any estimated spend-reduction wins for the just-completed week, then
 * generate the weekly brief.
 */
export async function runWeeklyBriefForUser(db: Db, provider: InsightProvider, userId: number): Promise<void> {
  await detectAnomalies(db, userId);
  await verifyMoneyWins(db, userId);

  const context = await assembleCoachingContext(db, userId, 'weekly_brief');
  if (context.weekStart) {
    await recordSpendReductionWins(db, userId, context.weekStart);
  }
  const stored = await generateAndStoreBrief(db, provider, userId, 'weekly_brief');
  if (stored) {
    await sendPushToUser(db, userId, {
      title: 'Your weekly money brief',
      body: 'A fresh read on your spending and one calm move for the week.',
      data: { tab: 'brief' },
    });
  }
}

/** Weekly driver for every user with a linked item. */
export async function runWeeklyBriefsForAllUsers(db: Db, provider: InsightProvider): Promise<void> {
  const rows = await db
    .selectDistinct({ userId: items.userId })
    .from(items)
    .innerJoin(users, eq(items.userId, users.id));
  for (const { userId } of rows) {
    await runWeeklyBriefForUser(db, provider, userId);
  }
}

/** Latest insight of a kind for a user (for the API/tests). */
export async function getLatestInsight(db: Db, userId: number, kind: 'first_look' | 'weekly_brief') {
  const [row] = await db
    .select()
    .from(insights)
    .where(and(eq(insights.userId, userId), eq(insights.kind, kind)))
    .orderBy(desc(insights.createdAt))
    .limit(1);
  return row ?? null;
}
