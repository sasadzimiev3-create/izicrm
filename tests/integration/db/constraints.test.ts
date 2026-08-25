import { describe, expect, it } from 'vitest';

import {
  archiveCard,
  expectPgCode,
  freezeCard,
  insertBalance,
  insertCard,
  insertUser,
  useAppDb,
  withUser,
} from '../harness.js';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY = '23503';
const CHECK_VIOLATION = '23514';

describe('ограничения схемы', () => {
  const db = useAppDb();

  it('DB-01: два активных дубля названия → 23505', async () => {
    const userId = await insertUser(db.pool(), '1001');
    await insertCard(db.pool(), userId, 'Сбер1', '2024-08-01');
    await expectPgCode(
      () => insertCard(db.pool(), userId, 'сбер1', '2024-08-01'),
      UNIQUE_VIOLATION,
    );
  });

  it('DB-02: дубль названия при архивной карте разрешён (C-6)', async () => {
    const userId = await insertUser(db.pool(), '1002');
    const first = await insertCard(db.pool(), userId, 'Сбер1', '2024-08-01');
    await insertBalance(db.pool(), {
      userId,
      cardId: first,
      effectiveDate: '2024-08-01',
      amount: '1000.00',
      capitalIn: '1000.00',
    });
    await archiveCard(db.pool(), userId, first, '2024-08-10', 'WITHDRAWN');
    const second = await insertCard(db.pool(), userId, 'Сбер1', '2024-08-11');
    expect(second).not.toBe(first);
  });

  it('DB-03: две актуальные записи на (карта, дата) → 23505', async () => {
    const userId = await insertUser(db.pool(), '1003');
    const cardId = await insertCard(db.pool(), userId, 'Альфа', '2024-08-01');
    await insertBalance(db.pool(), {
      userId,
      cardId,
      effectiveDate: '2024-08-01',
      amount: '100.00',
      capitalIn: '100.00',
    });
    await expectPgCode(
      () =>
        insertBalance(db.pool(), {
          userId,
          cardId,
          effectiveDate: '2024-08-01',
          amount: '200.00',
          source: 'DAILY_UPDATE',
        }),
      UNIQUE_VIOLATION,
    );
  });

  it('DB-06: card_id чужого пользователя → нарушение композитного FK', async () => {
    const alice = await insertUser(db.pool(), '1006');
    const bob = await insertUser(db.pool(), '2006');
    const bobCard = await insertCard(db.pool(), bob, 'Чужая', '2024-08-01');
    await expectPgCode(
      () =>
        insertBalance(db.pool(), {
          userId: alice,
          cardId: bobCard,
          effectiveDate: '2024-08-01',
          amount: '1.00',
        }),
      FOREIGN_KEY,
    );
  });

  it('имя из одних пробельных POSIX-символов → CHECK (name_norm <> \'\')', async () => {
    const userId = await insertUser(db.pool(), '1020');
    await expectPgCode(() => insertCard(db.pool(), userId, '\t', '2024-08-01'), CHECK_VIOLATION);
    await expectPgCode(() => insertCard(db.pool(), userId, '\n', '2024-08-01'), CHECK_VIOLATION);
  });

  it('DB-17: capital_in < 0 → ошибка CHECK', async () => {
    const userId = await insertUser(db.pool(), '1017');
    const cardId = await insertCard(db.pool(), userId, 'Чек', '2024-08-01');
    await expectPgCode(
      () =>
        insertBalance(db.pool(), {
          userId,
          cardId,
          effectiveDate: '2024-08-01',
          amount: '10.00',
          capitalIn: '-0.01',
        }),
      CHECK_VIOLATION,
    );
  });

  it('DB-17: заморозка архивной карты → ошибка CHECK', async () => {
    const userId = await insertUser(db.pool(), '1018');
    const cardId = await insertCard(db.pool(), userId, 'Архив', '2024-08-01');
    await insertBalance(db.pool(), {
      userId,
      cardId,
      effectiveDate: '2024-08-01',
      amount: '10.00',
      capitalIn: '10.00',
    });
    await archiveCard(db.pool(), userId, cardId, '2024-08-10', 'WITHDRAWN');
    await expectPgCode(() => freezeCard(db.pool(), userId, cardId, '2024-08-11'), CHECK_VIOLATION);
  });

  it('исправление за ту же дату: вытеснение, затем новая актуальная запись', async () => {
    const userId = await insertUser(db.pool(), '1019');
    const cardId = await insertCard(db.pool(), userId, 'Опечатка', '2024-08-01');
    const oldId = await insertBalance(db.pool(), {
      userId,
      cardId,
      effectiveDate: '2024-08-01',
      amount: '30000.00',
      capitalIn: '30000.00',
    });

    await withUser(db.pool(), userId, async (client) => {
      await client.query(
        `UPDATE balance_entries SET superseded_at = now(), superseded_by = id WHERE id = $1`,
        [oldId],
      );
    });

    await insertBalance(db.pool(), {
      userId,
      cardId,
      effectiveDate: '2024-08-01',
      amount: '3000.00',
      capitalIn: '3000.00',
      source: 'CORRECTION',
    });

    const current = await withUser(db.pool(), userId, async (client) => {
      const result = await client.query<{ amount: string; capital_in: string }>(
        `SELECT amount, capital_in FROM v_current_balance_entries WHERE card_id = $1`,
        [cardId],
      );
      return result.rows[0];
    });
    expect(current?.amount).toBe('3000.00');
    expect(current?.capital_in).toBe('3000.00');
  });
});
