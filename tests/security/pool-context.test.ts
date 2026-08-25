import { describe, expect, it } from 'vitest';

import { parseBusinessDate } from '../../src/domain/finance/period.js';
import { createDataAccess } from '../../src/infrastructure/db/data-access.js';
import { parseUserId } from '../../src/infrastructure/db/ids.js';
import { createPool } from '../../src/infrastructure/db/pool.js';
import { insertUser, useAppDb } from '../integration/harness.js';

const D = parseBusinessDate;

describe('контекст не утекает через пул', () => {
  const db = useAppDb();

  it('после транзакции A соединение в пуле не показывает данные A пользователю B', async () => {
    const pool = createPool(db.cluster().appUrl, { max: 1 });
    try {
      const { uow, cards } = createDataAccess(pool);
      const alice = parseUserId(await insertUser(pool, '91001'));
      const bob = parseUserId(await insertUser(pool, '91002'));

      const aliceCard = await uow.withUser(alice, async (tx) => {
        const card = await cards.insertUserCard(
          alice,
          { name: 'Алиса', createdOn: D('2024-08-01'), icon: null },
          tx,
        );
        expect(await cards.listUserCards(alice, tx)).toHaveLength(1);
        return card;
      });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const setting = await client.query<{ v: string | null }>(
          `SELECT current_setting('app.current_user_id', true) AS v`,
        );
        expect(setting.rows[0]?.v === null || setting.rows[0]?.v === '').toBe(true);
        const leaked = await client.query(`SELECT name FROM cards`);
        expect(leaked.rows).toHaveLength(0);
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      await uow.withUser(bob, async (tx) => {
        expect(await cards.listUserCards(bob, tx)).toHaveLength(0);
        expect(await cards.getUserCard(bob, aliceCard.id, tx)).toBeNull();
      });
    } finally {
      await pool.end();
    }
  });
});
