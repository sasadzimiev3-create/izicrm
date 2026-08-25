import { describe, expect, it } from 'vitest';

import { assertApplicationRole, createPool } from '../../src/infrastructure/db/pool.js';
import { adminPool, useAppDb } from '../integration/harness.js';

function withUserinfo(adminUrl: string, username: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = username;
  url.password = password;
  return url.toString();
}

describe('старт под опасной ролью', () => {
  const db = useAppDb();

  it('SUPERUSER — ошибка на старте', async () => {
    const admin = adminPool(db.cluster());
    try {
      await admin.query(
        `CREATE ROLE izicrm_super LOGIN SUPERUSER PASSWORD 'super_secret'`,
      );
      await admin.query(`GRANT CONNECT ON DATABASE izicrm TO izicrm_super`);
      await admin.query(`GRANT USAGE ON SCHEMA public TO izicrm_super`);
    } finally {
      await admin.end();
    }

    const pool = createPool(withUserinfo(db.cluster().adminUrl, 'izicrm_super', 'super_secret'));
    try {
      await expect(assertApplicationRole(pool)).rejects.toThrow(/SUPERUSER|BYPASSRLS|DELETE/);
    } finally {
      await pool.end();
    }
  });

  it('BYPASSRLS — ошибка на старте', async () => {
    const admin = adminPool(db.cluster());
    try {
      await admin.query(
        `CREATE ROLE izicrm_bypass LOGIN NOSUPERUSER BYPASSRLS PASSWORD 'bypass_secret'`,
      );
      await admin.query(`GRANT CONNECT ON DATABASE izicrm TO izicrm_bypass`);
      await admin.query(`GRANT USAGE ON SCHEMA public TO izicrm_bypass`);
    } finally {
      await admin.end();
    }

    const pool = createPool(withUserinfo(db.cluster().adminUrl, 'izicrm_bypass', 'bypass_secret'));
    try {
      await expect(assertApplicationRole(pool)).rejects.toThrow(/BYPASSRLS/);
    } finally {
      await pool.end();
    }
  });
});
