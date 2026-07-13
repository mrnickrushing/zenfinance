import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/client.js';
import { pushTokens, users } from '../db/schema.js';
import { sendPushToUser, sentPushes } from '../lib/push.js';
import { closeDb, migrateOnce, truncateAll } from './setup.js';

beforeAll(async () => {
  await migrateOnce();
});

beforeEach(async () => {
  await truncateAll();
  sentPushes.length = 0;
});

afterAll(async () => {
  await closeDb();
});

async function makeUser(email: string): Promise<number> {
  const [row] = await db.insert(users).values({ email }).returning({ id: users.id });
  return row!.id;
}

describe('sendPushToUser', () => {
  it('sends to every enabled device with the routing payload', async () => {
    const userId = await makeUser('push@example.com');
    await db.insert(pushTokens).values([
      { userId, token: 'ExponentPushToken[aaa]' },
      { userId, token: 'ExponentPushToken[bbb]' },
      { userId, token: 'ExponentPushToken[ccc]', enabled: false },
    ]);

    const count = await sendPushToUser(db, userId, {
      title: 'Your weekly money brief',
      body: 'A fresh read.',
      data: { tab: 'brief' },
    });

    expect(count).toBe(2); // disabled token skipped
    expect(sentPushes).toHaveLength(2);
    expect(sentPushes.map((p) => p.to).sort()).toEqual(['ExponentPushToken[aaa]', 'ExponentPushToken[bbb]']);
    expect(sentPushes[0]!.data).toEqual({ tab: 'brief' });
    expect(sentPushes[0]!.title).toBe('Your weekly money brief');
  });

  it('is a no-op for a user with no registered devices', async () => {
    const userId = await makeUser('notoken@example.com');
    const count = await sendPushToUser(db, userId, { title: 'Hi', body: 'There' });
    expect(count).toBe(0);
    expect(sentPushes).toHaveLength(0);
  });
});
