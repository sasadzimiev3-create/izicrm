import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminPool,
  migrate,
  startCluster,
  type StartedCluster,
} from '../harness.js';

const TABLES = [
  'audit_log',
  'balance_entries',
  'cards',
  'dialog_states',
  'pgmigrations',
  'processed_updates',
  'users',
];

const VIEWS = ['v_capital_flows', 'v_current_balance_entries'];

const ENUMS = ['archive_reason', 'balance_entry_source', 'capital_flow_kind'];

const INDEXES = [
  'cards_active_name_uniq',
  'cards_user_active_idx',
  'cards_user_working_idx',
  'cards_user_scope_idx',
  'be_current_per_card_day_uniq',
  'be_locf_idx',
  'be_user_date_idx',
  'dialog_states_expiry_idx',
  'processed_updates_gc_idx',
  'audit_log_user_idx',
];

async function publicNames(
  cluster: StartedCluster,
  sql: string,
  column: string,
): Promise<string[]> {
  const pool = adminPool(cluster);
  try {
    const result = await pool.query<Record<string, string>>(sql);
    return result.rows.map((row) => row[column]).filter((name): name is string => name !== undefined);
  } finally {
    await pool.end();
  }
}

async function assertExpectedSchema(cluster: StartedCluster): Promise<void> {
  const tables = await publicNames(
    cluster,
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
    'name',
  );
  expect(tables).toEqual(TABLES);

  const views = await publicNames(
    cluster,
    `SELECT viewname AS name FROM pg_views WHERE schemaname = 'public' ORDER BY 1`,
    'name',
  );
  expect(views).toEqual(VIEWS);

  const enums = await publicNames(
    cluster,
    `SELECT t.typname AS name
     FROM pg_type t
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype = 'e'
     ORDER BY 1`,
    'name',
  );
  expect(enums).toEqual(ENUMS);

  const pool = adminPool(cluster);
  try {
    const indexes = await pool.query<{ name: string }>(
      `SELECT indexname AS name FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[])
       ORDER BY 1`,
      [INDEXES],
    );
    expect(indexes.rows.map((row) => row.name).toSorted()).toEqual([...INDEXES].toSorted());

    const floats = await pool.query(
      `SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod) AS typ
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND a.attnum > 0 AND NOT a.attisdropped
         AND format_type(a.atttypid, a.atttypmod) IN ('real', 'double precision')`,
    );
    expect(floats.rows).toEqual([]);

    const applied = await pool.query<{ name: string }>(
      `SELECT name FROM pgmigrations ORDER BY name`,
    );
    expect(applied.rows.map((row) => row.name)).toEqual([
      '0001_roles_and_extensions',
      '0002_enums',
      '0003_users',
      '0004_cards',
      '0005_balance_entries',
      '0006_append_only_guards',
      '0007_dialog_states',
      '0008_processed_updates',
      '0009_audit_log',
      '0010_views',
      '0011_row_level_security',
      '0012_grants',
      '0013_maintenance_role',
    ]);
  } finally {
    await pool.end();
  }
}

describe('DB-15 миграции', () => {
  let cluster: StartedCluster;

  beforeAll(async () => {
    cluster = await startCluster();
  }, 180_000);

  afterAll(async () => {
    await cluster.container.stop();
  });

  it('применяются на чистой базе и дают ожидаемую схему', async () => {
    await assertExpectedSchema(cluster);
  });

  it('откат и повторное применение проходят', async () => {
    await migrate(cluster.adminUrl, 'down', 20);
    const leftover = await publicNames(
      cluster,
      `SELECT tablename AS name FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> 'pgmigrations'
       ORDER BY 1`,
      'name',
    );
    expect(leftover).toEqual([]);

    await migrate(cluster.adminUrl, 'up');
    await assertExpectedSchema(cluster);
  });
});
