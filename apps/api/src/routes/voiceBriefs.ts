import {
  voiceBriefEventSchema,
  type InsightClaim,
  type VoiceBriefEventInput,
  type VoiceBriefSegmentView,
  type VoiceBriefView,
} from '@zenfinance/shared';
import type { InferSelectModel } from 'drizzle-orm';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { assertPremium } from '../billing/service.js';
import { db } from '../db/client.js';
import { appEvents, insights, voiceBriefs } from '../db/schema.js';
import { requireUser } from '../middleware/userAuth.js';
import { validateBody } from '../middleware/validate.js';

type InsightRow = InferSelectModel<typeof insights>;
type VoiceBriefRow = InferSelectModel<typeof voiceBriefs>;

const WORDS_PER_MINUTE = 155;
const MAX_SCRIPT_WORDS = 225;

function cents(amount: number): string {
  const sign = amount < 0 ? 'negative ' : '';
  return `${sign}${Math.round(Math.abs(amount) / 100).toLocaleString('en-US')} dollars`;
}

function sentence(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function trimWords(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return value.trim();
  return `${words.slice(0, maxWords).join(' ')}.`;
}

function durationFor(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(3, Math.round((words / WORDS_PER_MINUTE) * 60));
}

function claimsLine(claims: InsightClaim[]): string {
  const claim = claims[0];
  if (!claim) return '';
  return `The number to remember is ${cents(claim.amountCents)} for ${claim.label}.`;
}

function buildVoiceScript(insight: InsightRow): { script: string; segments: VoiceBriefSegmentView[]; durationSeconds: number } {
  const claims = (insight.claims as InsightClaim[]) ?? [];
  const intro = insight.kind === 'weekly_brief' ? 'Here is your ZenFinance weekly voice brief.' : 'Here is your first ZenFinance voice brief.';
  const summary = trimWords(`${sentence(insight.headline)} ${sentence(insight.body)} ${claimsLine(claims)}`, 125);
  const action = trimWords(
    `Your next action is: ${sentence(insight.actionDescription)} ${insight.actionEstimatedImpactCents ? `Estimated impact: ${cents(insight.actionEstimatedImpactCents)}.` : ''} Timeframe: ${sentence(insight.actionTimeframe)}`,
    70,
  );
  const closing = 'That is it. Keep it simple, and take the next small step when you are ready.';
  const rawSegments: Array<Omit<VoiceBriefSegmentView, 'durationSeconds'>> = [
    { label: 'intro', text: intro },
    { label: 'summary', text: summary },
    { label: 'action', text: action },
    { label: 'closing', text: closing },
  ];
  const script = trimWords(rawSegments.map((segment) => segment.text).join(' '), MAX_SCRIPT_WORDS);
  const segments = rawSegments.map((segment) => ({ ...segment, durationSeconds: durationFor(segment.text) }));
  return {
    script,
    segments,
    durationSeconds: Math.min(90, Math.max(10, durationFor(script))),
  };
}

function toView(row: VoiceBriefRow, insight: Pick<InsightRow, 'kind' | 'headline'>): VoiceBriefView {
  return {
    id: row.id,
    insightId: row.insightId,
    insightKind: insight.kind,
    headline: insight.headline,
    script: row.script,
    durationSeconds: row.durationSeconds,
    segments: (row.segments as VoiceBriefSegmentView[]) ?? [],
    playCount: row.playCount,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function latestInsightForVoice(userId: number): Promise<InsightRow | null> {
  const [weekly] = await db
    .select()
    .from(insights)
    .where(and(eq(insights.userId, userId), eq(insights.kind, 'weekly_brief')))
    .orderBy(desc(insights.createdAt))
    .limit(1);
  if (weekly) return weekly;
  const [firstLook] = await db
    .select()
    .from(insights)
    .where(and(eq(insights.userId, userId), eq(insights.kind, 'first_look')))
    .orderBy(desc(insights.createdAt))
    .limit(1);
  return firstLook ?? null;
}

async function getOrCreateVoiceBrief(userId: number): Promise<VoiceBriefView | null> {
  const insight = await latestInsightForVoice(userId);
  if (!insight) return null;
  const existing = await db.select().from(voiceBriefs).where(eq(voiceBriefs.insightId, insight.id)).limit(1);
  if (existing[0]) return toView(existing[0], insight);

  const generated = buildVoiceScript(insight);
  const [row] = await db
    .insert(voiceBriefs)
    .values({
      userId,
      insightId: insight.id,
      script: generated.script,
      segments: generated.segments,
      durationSeconds: generated.durationSeconds,
    })
    .returning();
  return toView(row!, insight);
}

export function createVoiceBriefsRouter(): ReturnType<typeof Router> {
  const router = Router();

  router.get('/api/voice-brief/latest', requireUser, async (_req, res) => {
    const userId = res.locals.userId as number;
    const premium = await assertPremium(db, userId, 'voice_brief');
    if (!premium.ok) {
      res.status(402).json(premium.payload);
      return;
    }
    const voiceBrief = await getOrCreateVoiceBrief(userId);
    if (!voiceBrief) {
      res.status(404).json({ error: { code: 'not_found', message: 'No brief is ready for voice playback yet.' } });
      return;
    }
    res.json(voiceBrief);
  });

  router.post('/api/voice-briefs/:id/events', requireUser, validateBody(voiceBriefEventSchema), async (req, res) => {
    const userId = res.locals.userId as number;
    const id = Number(req.params.id);
    const input = res.locals.body as VoiceBriefEventInput;
    const [existing] = await db
      .select({ id: voiceBriefs.id })
      .from(voiceBriefs)
      .where(and(eq(voiceBriefs.id, id), eq(voiceBriefs.userId, userId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: { code: 'not_found', message: 'Voice brief not found.' } });
      return;
    }

    if (input.event === 'started') {
      await db
        .update(voiceBriefs)
        .set({ playCount: sql`${voiceBriefs.playCount} + 1`, updatedAt: new Date() })
        .where(eq(voiceBriefs.id, existing.id));
    } else {
      await db
        .update(voiceBriefs)
        .set({ completedAt: new Date(), updatedAt: new Date() })
        .where(eq(voiceBriefs.id, existing.id));
    }
    await db.insert(appEvents).values({
      userId,
      name: `voice_brief:${input.event}`,
      properties: { voiceBriefId: id, positionSeconds: input.positionSeconds ?? null },
    });
    res.json({ ok: true });
  });

  return router;
}
