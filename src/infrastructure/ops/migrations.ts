import { readdirSync } from 'node:fs';
import path from 'node:path';

import type pg from 'pg';

export const MIGRATIONS_TABLE = 'pgmigrations';

export function defaultMigrationsDir(): string {
  return path.join(process.cwd(), 'migrations');
}

/**
 * Имена файлов `NNNN_*.sql` без расширения — так их пишет node-pg-migrate.
 */
export function expectedMigrationNames(dir: string = defaultMigrationsDir()): string[] {
  return readdirSync(dir)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .map((name) => name.replace(/\.sql$/u, ''))
    .sort();
}

export async function listAppliedMigrations(pool: pg.Pool): Promise<string[]> {
  const result = await pool.query<{ name: string }>(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`,
  );
  return result.rows.map((row) => row.name);
}

/**
 * Приложение не поднимается, пока не применены все миграции из каталога
 * (`docs/database.md` §8).
 */
export async function assertMigrationsApplied(
  pool: pg.Pool,
  dir: string = defaultMigrationsDir(),
): Promise<void> {
  const expected = expectedMigrationNames(dir);
  if (expected.length === 0) {
    throw new Error(`no migration files found in ${dir}`);
  }
  let applied: string[];
  try {
    applied = await listAppliedMigrations(pool);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read ${MIGRATIONS_TABLE}: ${message}`);
  }
  const missing = expected.filter((name) => !applied.includes(name));
  if (missing.length > 0) {
    throw new Error(`migrations not applied: ${missing.join(', ')}`);
  }
}
