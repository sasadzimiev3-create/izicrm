import { describe, expect, it } from 'vitest';

import { insertCard, insertUser, useAppDb } from '../harness.js';
import { setLocalUserId } from '../../../src/infrastructure/db/user-context.js';

describe('DB-12 контекст LOCAL', () => {
  const db = useAppDb();

  it('set_config(..., true) не переживает COMMIT', async () => {
    const userId = await insertUser(db.pool(), '1200');
    await insertCard(db.pool(), userId, 'Локальный', '2024-08-01');

    const client = await db.pool().connect();
    try {
      await client.query('BEGIN');
      await setLocalUserId(client, userId);
      const inside = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM cards`);
      expect(inside.rows[0]?.n).toBe('1');
      await client.query('COMMIT');

      const setting = await client.query<{ v: string | null }>(
        `SELECT current_setting('app.current_user_id', true) AS v`,
      );
      expect(setting.rows[0]?.v === null || setting.rows[0]?.v === '').toBe(true);

      const after = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM cards`);
      expect(after.rows[0]?.n).toBe('0');
    } finally {
      client.release();
    }
  });
});
