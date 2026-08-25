import { describe, expect, it } from 'vitest';

import {
  adminPool,
  insertBalance,
  insertCard,
  insertUser,
  useAppDb,
  withUser,
} from '../harness.js';

describe('append-only', () => {
  const db = useAppDb();

  it('DB-04: UPDATE суммы и capital_in блокируется триггером', async () => {
    const userId = await insertUser(db.pool(), '4001');
    const cardId = await insertCard(db.pool(), userId, 'Иммут', '2024-08-01');
    const entryId = await insertBalance(db.pool(), {
      userId,
      cardId,
      effectiveDate: '2024-08-01',
      amount: '100.00',
      capitalIn: '100.00',
    });

    await withUser(db.pool(), userId, async (client) => {
      await expect(
        client.query(`UPDATE balance_entries SET amount = 1 WHERE id = $1`, [entryId]),
      ).rejects.toThrow(/append-only/i);
    });

    await withUser(db.pool(), userId, async (client) => {
      await expect(
        client.query(`UPDATE balance_entries SET capital_in = 1 WHERE id = $1`, [entryId]),
      ).rejects.toThrow(/append-only/i);
    });

    const kept = await withUser(db.pool(), userId, async (client) => {
      const result = await client.query<{ amount: string; capital_in: string }>(
        `SELECT amount, capital_in FROM balance_entries WHERE id = $1`,
        [entryId],
      );
      return result.rows[0];
    });
    expect(kept?.amount).toBe('100.00');
    expect(kept?.capital_in).toBe('100.00');
  });

  it('DB-05: DELETE из balance_entries удаляет ноль строк', async () => {
    const userId = await insertUser(db.pool(), '4002');
    const cardId = await insertCard(db.pool(), userId, 'Неудаляемая', '2024-08-01');
    const entryId = await insertBalance(db.pool(), {
      userId,
      cardId,
      effectiveDate: '2024-08-01',
      amount: '50.00',
      capitalIn: '50.00',
    });

    // Правило проверяем ролью, у которой есть DELETE; у izicrm_app DELETE нет (DB-11).
    const admin = adminPool(db.cluster());
    try {
      const deleted = await admin.query(`DELETE FROM balance_entries WHERE id = $1`, [entryId]);
      expect(deleted.rowCount).toBe(0);
    } finally {
      await admin.end();
    }

    const stillThere = await withUser(db.pool(), userId, async (client) => {
      const result = await client.query(`SELECT id FROM balance_entries WHERE id = $1`, [entryId]);
      return result.rows.length;
    });
    expect(stillThere).toBe(1);
  });
});
