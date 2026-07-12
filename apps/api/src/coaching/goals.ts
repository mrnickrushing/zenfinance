import type { InferSelectModel } from 'drizzle-orm';
import type { goals } from '../db/schema.js';

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

export type Goal = InferSelectModel<typeof goals>;

export type PacingStatus = 'on_track' | 'behind' | 'ahead' | 'no_deadline' | 'unknown';

export interface GoalPacing {
  goalId: number;
  name: string;
  targetAmountCents: number;
  currentAmountCents: number;
  remainingAmountCents: number;
  progressRatio: number; // 0..1, clamped
  targetDate: string | null;
  weeksRemaining: number | null; // null if no deadline or deadline passed
  weeklyTargetCents: number | null; // per-week set-aside needed to hit target by the deadline
  projectedCompletionDate: string | null; // from the recent net-savings rate; null if not projectable
  pacingStatus: PacingStatus;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pure, deterministic goal pacing (PLAN §4: derived figures are computed in
 * code, never by the model). `recentWeeklyNetCents` is the user's recent
 * average weekly net savings (income − spend), used to project a completion
 * date; pass 0/negative when unknown or the user isn't net-saving.
 */
export function computeGoalPacing(goal: Goal, recentWeeklyNetCents: number, now: Date = new Date()): GoalPacing {
  const remaining = Math.max(0, goal.targetAmountCents - goal.currentAmountCents);
  const progressRatio =
    goal.targetAmountCents > 0 ? Math.min(1, goal.currentAmountCents / goal.targetAmountCents) : 1;

  let weeksRemaining: number | null = null;
  let weeklyTargetCents: number | null = null;
  if (goal.targetDate) {
    const msLeft = Date.parse(goal.targetDate) - now.getTime();
    if (msLeft > 0) {
      weeksRemaining = Math.max(1, Math.ceil(msLeft / WEEK_MS));
      weeklyTargetCents = Math.ceil(remaining / weeksRemaining);
    } else {
      weeksRemaining = 0;
    }
  }

  // Project completion from the recent net-savings rate.
  let projectedCompletionDate: string | null = null;
  if (remaining === 0) {
    projectedCompletionDate = isoDate(now);
  } else if (recentWeeklyNetCents > 0) {
    const weeksToComplete = Math.ceil(remaining / recentWeeklyNetCents);
    projectedCompletionDate = isoDate(new Date(now.getTime() + weeksToComplete * WEEK_MS));
  }

  let pacingStatus: PacingStatus;
  if (remaining === 0) {
    pacingStatus = 'ahead';
  } else if (!goal.targetDate) {
    pacingStatus = 'no_deadline';
  } else if (weeksRemaining === 0) {
    pacingStatus = 'behind'; // deadline passed, not met
  } else if (projectedCompletionDate === null) {
    pacingStatus = 'unknown'; // not net-saving; can't project
  } else {
    pacingStatus = Date.parse(projectedCompletionDate) <= Date.parse(goal.targetDate) ? 'on_track' : 'behind';
  }

  return {
    goalId: goal.id,
    name: goal.name,
    targetAmountCents: goal.targetAmountCents,
    currentAmountCents: goal.currentAmountCents,
    remainingAmountCents: remaining,
    progressRatio,
    targetDate: goal.targetDate,
    weeksRemaining,
    weeklyTargetCents,
    projectedCompletionDate,
    pacingStatus,
  };
}
