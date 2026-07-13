import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pushTokens } from '../db/schema.js';
import { env } from '../env.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushPayload {
  title: string;
  body: string;
  /** Routed by the app to a screen — e.g. { tab: 'brief' }. */
  data?: Record<string, unknown>;
}

export interface SentPush {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

/**
 * In-memory outbox under NODE_ENV=test (or PUSH_PROVIDER=memory) so tests can
 * assert what would have been pushed without calling Expo. Never used in prod.
 */
export const sentPushes: SentPush[] = [];

function useMemoryTransport(): boolean {
  return env.NODE_ENV === 'test' || process.env.PUSH_PROVIDER === 'memory';
}

/**
 * Send a push to every enabled device a user has registered. Best-effort: a
 * delivery failure is logged, never thrown — a brief must still be generated
 * even if the notification can't go out. Returns the number of devices sent to.
 */
export async function sendPushToUser(db: Db, userId: number, payload: PushPayload): Promise<number> {
  const tokens = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.enabled, true)));
  if (tokens.length === 0) return 0;

  const messages = tokens.map((t) => ({
    to: t.token,
    title: payload.title,
    body: payload.body,
    sound: 'default' as const,
    data: payload.data ?? {},
  }));

  if (useMemoryTransport()) {
    for (const m of messages) sentPushes.push({ to: m.to, title: m.title, body: m.body, data: m.data });
    return messages.length;
  }

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      console.error(`[push] Expo responded ${res.status} for user ${userId}`);
      return 0;
    }
    return messages.length;
  } catch (err) {
    console.error(`[push] failed to send to user ${userId}:`, err);
    return 0;
  }
}
