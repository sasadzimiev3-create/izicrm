import { describe, expect, it } from 'vitest';

import { parseUserId } from '../../../src/infrastructure/db/ids.js';
import { parseBusinessDate } from '../../../src/domain/finance/period.js';
import { createDataAccess } from '../../../src/infrastructure/db/data-access.js';
import { adminPool, insertUser, useAppDb, withUser } from '../harness.js';

describe('DB-18 активность', () => {
  const db = useAppDb();

  it('снимок считает дни без сумм; чужой не видит activity', async () => {
    const pool = db.pool();
    const alice = await insertUser(pool, '19001');
    const bob = await insertUser(pool, '19002');
    const access = createDataAccess(pool);
    const aliceId = parseUserId(alice);
    const today = parseBusinessDate('2024-08-20');
    const yesterday = parseBusinessDate('2024-08-19');

    const admin = adminPool(db.cluster());
    try {
      await admin.query(`UPDATE users SET created_at = $1 WHERE id = ANY($2::bigint[])`, [
        new Date('2024-08-01T12:00:00+03:00'),
        [alice, bob],
      ]);

      await access.uow.withUser(aliceId, async (tx) => {
        await access.activity.touchUserDay(aliceId, yesterday, tx);
        await access.activity.touchUserDay(aliceId, today, tx);
      });

      const snapshot = await access.uow.withUser(aliceId, (tx) =>
        access.activity.loadSnapshot(new Date('2024-08-20T12:00:00+03:00'), 'Europe/Moscow', tx),
      );

      expect(Number(snapshot.registeredAll)).toBeGreaterThanOrEqual(2);
      expect(snapshot.usedAfterStartToday).toBe('1');
      expect(snapshot.usedToday).toBe('1');
      expect(snapshot.usedWeek).toBe('1');
      expect(snapshot.streakToday).toBe('1');
      expect(JSON.stringify(snapshot)).not.toMatch(/amount|capital|₽/i);

      await admin.query(`UPDATE users SET created_at = $1 WHERE id = $2`, [
        new Date('2024-08-20T08:00:00+03:00'),
        bob,
      ]);

      const withNewStart = await access.uow.withUser(aliceId, (tx) =>
        access.activity.loadSnapshot(new Date('2024-08-20T12:00:00+03:00'), 'Europe/Moscow', tx),
      );
      expect(withNewStart.usedToday).toBe('2');
      expect(withNewStart.usedWeek).toBe('2');
      expect(withNewStart.usedAfterStartToday).toBe('1');
      expect(withNewStart.newStartToday).toBe('1');
    } finally {
      await admin.end();
    }

    const seen = await withUser(pool, bob, async (client) => {
      const result = await client.query(`SELECT user_id FROM user_activity_days`);
      return result.rows;
    });
    expect(seen).toHaveLength(0);
  });
});
