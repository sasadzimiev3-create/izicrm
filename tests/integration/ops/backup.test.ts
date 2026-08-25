import { describe, expect, it } from 'vitest';

import { insertBalance, insertCard, insertUser, useAppDb, withUser } from '../harness.js';

describe('бэкап с проверенным восстановлением', () => {
  const db = useAppDb();

  it('pg_dump → pg_restore сохраняет финансовую строку', async () => {
    const pool = db.pool();
    const userId = await insertUser(pool, '19001');
    const cardId = await insertCard(pool, userId, 'Альфа', '2024-08-01');
    await insertBalance(pool, {
      userId,
      cardId,
      effectiveDate: '2024-08-01',
      amount: '1234.56',
      capitalIn: '1234.56',
    });

    const container = db.cluster().container;
    const dump = await container.exec([
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'izicrm',
      '-Fc',
      '--no-owner',
      '-f',
      '/tmp/izicrm.dump',
    ]);
    expect(dump.exitCode, dump.output).toBe(0);

    const restore = await container.exec([
      'sh',
      '-c',
      [
        'dropdb --if-exists -U postgres izicrm_restore_verify',
        'createdb -U postgres izicrm_restore_verify',
        'pg_restore -U postgres -d izicrm_restore_verify --no-owner --no-acl /tmp/izicrm.dump',
        `psql -U postgres -d izicrm_restore_verify -tA -c "SELECT amount FROM balance_entries"`,
        'dropdb -U postgres izicrm_restore_verify',
      ].join(' && '),
    ]);
    expect(restore.exitCode, restore.output).toBe(0);
    expect(restore.output).toContain('1234.56');

    await withUser(pool, userId, async (client) => {
      const live = await client.query<{ amount: string }>(`SELECT amount FROM balance_entries`);
      expect(live.rows[0]?.amount).toBe('1234.56');
    });
  });
});
