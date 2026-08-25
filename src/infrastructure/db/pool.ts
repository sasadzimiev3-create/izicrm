import pg from 'pg';

import { assertNumericParserIsIdentity, configurePgTypes } from './types.js';

export type AppRoleSafetyRow = {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  can_delete_balance_entries: boolean;
};

/**
 * Пул приложения. Type parser-ы настраиваются здесь, один раз на процесс.
 */
export function createPool(connectionString: string): pg.Pool {
  configurePgTypes();
  assertNumericParserIsIdentity();
  return new pg.Pool({
    connectionString,
    options: '-c search_path=public',
  });
}

/**
 * Приложение подключается только как `izicrm_app`: без SUPERUSER, BYPASSRLS и DELETE.
 * Попытка старта под опасной ролью — ошибка (`docs/database.md` §2).
 */
export async function assertApplicationRole(pool: pg.Pool): Promise<void> {
  const result = await pool.query<AppRoleSafetyRow>(
    `SELECT
       current_user AS rolname,
       r.rolsuper,
       r.rolbypassrls,
       has_table_privilege(current_user, 'balance_entries', 'DELETE') AS can_delete_balance_entries
     FROM pg_roles r
     WHERE r.rolname = current_user`,
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('current database role was not found in pg_roles');
  }
  if (row.rolsuper || row.rolbypassrls || row.can_delete_balance_entries) {
    throw new Error(
      `Refusing to start as ${row.rolname}: SUPERUSER, BYPASSRLS and DELETE on financial tables are forbidden`,
    );
  }
}
