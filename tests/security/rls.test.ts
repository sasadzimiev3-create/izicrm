import { describe, expect, it } from 'vitest';

import {
  expectPgCode,
  insertCard,
  insertUser,
  useAppDb,
  withUser,
} from '../integration/harness.js';
import { setLocalTelegramId, setLocalUserId } from '../../src/infrastructure/db/user-context.js';

const RLS_VIOLATION = '42501';

const USER_TABLES = ['cards', 'balance_entries', 'dialog_states', 'audit_log', 'processed_updates', 'user_activity_days', 'web_logins'] as const;

describe('изоляция RLS', () => {
  const db = useAppDb();

  it('DB-07: без контекста — ноль строк во всех таблицах', async () => {
    const userId = await insertUser(db.pool(), '7001');
    await insertCard(db.pool(), userId, 'Своя', '2024-08-01');

    const client = await db.pool().connect();
    try {
      const users = await client.query(`SELECT id FROM users`);
      expect(users.rows).toHaveLength(0);

      for (const table of USER_TABLES) {
        const result = await client.query(`SELECT 1 FROM ${table}`);
        expect(result.rows, table).toHaveLength(0);
      }
    } finally {
      client.release();
    }
  });

  it('DB-08: чужой контекст — ноль строк', async () => {
    const alice = await insertUser(db.pool(), '8001');
    const bob = await insertUser(db.pool(), '8002');
    await insertCard(db.pool(), alice, 'Карта Алисы', '2024-08-01');

    const seen = await withUser(db.pool(), bob, async (client) => {
      const result = await client.query(`SELECT name FROM cards`);
      return result.rows;
    });
    expect(seen).toHaveLength(0);
  });

  it('DB-09: INSERT с чужим user_id → WITH CHECK', async () => {
    const alice = await insertUser(db.pool(), '9001');
    const bob = await insertUser(db.pool(), '9002');

    await expectPgCode(
      () =>
        withUser(db.pool(), alice, async (client) => {
          await client.query(
            `INSERT INTO cards (user_id, name, created_on) VALUES ($1, $2, $3::date)`,
            [bob, 'Чужая запись', '2024-08-01'],
          );
        }),
      RLS_VIOLATION,
    );
  });

  it('users без telegram-контекста не вставляются', async () => {
    const client = await db.pool().connect();
    try {
      await client.query('BEGIN');
      await expectPgCode(
        () => client.query(`INSERT INTO users (telegram_id) VALUES (999)`),
        RLS_VIOLATION,
      );
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await setLocalTelegramId(client, '999');
      const inserted = await client.query(`INSERT INTO users (telegram_id) VALUES (999) RETURNING id`);
      expect(inserted.rows).toHaveLength(1);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('после LOCAL чужой user_id не читает карты', async () => {
    const alice = await insertUser(db.pool(), '9003');
    await insertCard(db.pool(), alice, 'Только Алиса', '2024-08-01');

    const client = await db.pool().connect();
    try {
      await client.query('BEGIN');
      await setLocalUserId(client, alice);
      const mine = await client.query(`SELECT name FROM cards`);
      expect(mine.rows).toHaveLength(1);
      await client.query('COMMIT');

      await client.query('BEGIN');
      await setLocalUserId(client, '0');
      const none = await client.query(`SELECT name FROM cards`);
      expect(none.rows).toHaveLength(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});
