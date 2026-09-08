import { describe, expect, it } from 'vitest';

import { parseUserId } from '../../../src/infrastructure/db/ids.js';
import { createDataAccess } from '../../../src/infrastructure/db/data-access.js';
import { insertUser, useAppDb, withUser } from '../harness.js';

describe('DB-19 напоминания', () => {
  const db = useAppDb();

  it('очередь не дублирует отправку; чужой не видит настройки', async () => {
    const pool = db.pool();
    const alice = await insertUser(pool, '21001');
    const bob = await insertUser(pool, '21002');
    const access = createDataAccess(pool);
    const aliceId = parseUserId(alice);
    const now = new Date('2024-08-20T21:00:30+03:00');

    await access.uow.withUser(aliceId, async (tx) => {
      await access.reminders.upsertUserReminder(
        aliceId,
        { enabled: true, notifyMinute: 21 * 60, days: 127 },
        tx,
      );
    });

    const first = await access.uow.withOps((tx) => access.reminders.claimDueReminders(now, tx));
    expect(first).toEqual(['21001']);
    const second = await access.uow.withOps((tx) => access.reminders.claimDueReminders(now, tx));
    expect(second).toEqual([]);

    const seen = await withUser(pool, bob, async (client) => {
      const result = await client.query(`SELECT user_id FROM reminders`);
      return result.rows;
    });
    expect(seen).toHaveLength(0);
  });
});
