import { describe, expect, it } from 'vitest';

import { assertApplicationRole } from '../../src/infrastructure/db/pool.js';
import {
  adminPool,
  insertUser,
  maintenancePool,
  useAppDb,
  withUser,
} from '../integration/harness.js';

describe('роли', () => {
  const db = useAppDb();

  it('DB-11: izicrm_app без SUPERUSER, BYPASSRLS и DELETE', async () => {
    const admin = adminPool(db.cluster());
    try {
      const role = await admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'izicrm_app'`,
      );
      expect(role.rows[0]?.rolsuper).toBe(false);
      expect(role.rows[0]?.rolbypassrls).toBe(false);

      const del = await admin.query<{ allowed: boolean }>(
        `SELECT has_table_privilege('izicrm_app', 'balance_entries', 'DELETE') AS allowed`,
      );
      expect(del.rows[0]?.allowed).toBe(false);

      const delCards = await admin.query<{ allowed: boolean }>(
        `SELECT has_table_privilege('izicrm_app', 'cards', 'DELETE') AS allowed`,
      );
      expect(delCards.rows[0]?.allowed).toBe(false);

      const auditUpdate = await admin.query<{ allowed: boolean }>(
        `SELECT has_table_privilege('izicrm_app', 'audit_log', 'UPDATE') AS allowed`,
      );
      expect(auditUpdate.rows[0]?.allowed).toBe(false);
    } finally {
      await admin.end();
    }

    await assertApplicationRole(db.pool());
  });

  it('DB-16: обслуживание не видит финансы; живой диалог не удаляется', async () => {
    const admin = adminPool(db.cluster());
    try {
      const finance = await admin.query<{ cards_select: boolean; cards_delete: boolean; be_select: boolean; be_delete: boolean }>(
        `SELECT
           has_table_privilege('izicrm_maintenance', 'cards', 'SELECT') AS cards_select,
           has_table_privilege('izicrm_maintenance', 'cards', 'DELETE') AS cards_delete,
           has_table_privilege('izicrm_maintenance', 'balance_entries', 'SELECT') AS be_select,
           has_table_privilege('izicrm_maintenance', 'balance_entries', 'DELETE') AS be_delete`,
      );
      expect(finance.rows[0]?.cards_select).toBe(false);
      expect(finance.rows[0]?.cards_delete).toBe(false);
      expect(finance.rows[0]?.be_select).toBe(false);
      expect(finance.rows[0]?.be_delete).toBe(false);
    } finally {
      await admin.end();
    }

    const userId = await insertUser(db.pool(), '1600');
    await withUser(db.pool(), userId, async (client) => {
      await client.query(
        `INSERT INTO dialog_states (user_id, state, expires_at)
         VALUES ($1, 'Idle', now() + interval '1 hour')`,
        [userId],
      );
    });

    const expiredUser = await insertUser(db.pool(), '1601');
    await withUser(db.pool(), expiredUser, async (client) => {
      await client.query(
        `INSERT INTO dialog_states (user_id, state, expires_at)
         VALUES ($1, 'Idle', TIMESTAMPTZ '2000-01-01 00:00:00+00')`,
        [expiredUser],
      );
    });

    const check = adminPool(db.cluster());
    try {
      const grants = await check.query<{ can_delete: boolean }>(
        `SELECT has_table_privilege('izicrm_maintenance', 'dialog_states', 'DELETE') AS can_delete`,
      );
      expect(grants.rows[0]?.can_delete).toBe(true);

      const rows = await check.query<{ user_id: string; is_expired: boolean }>(
        `SELECT user_id, expires_at < now() AS is_expired FROM dialog_states ORDER BY user_id`,
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows.find((row) => row.user_id === expiredUser)?.is_expired).toBe(true);
      expect(rows.rows.find((row) => row.user_id === userId)?.is_expired).toBe(false);
      const policies = await check.query<{ polname: string; polcmd: string; polpermissive: boolean }>(
        `SELECT p.polname, p.polcmd, p.polpermissive
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'dialog_states'
         ORDER BY p.polname`,
      );
      expect(policies.rows).toEqual([
        { polname: 'dialog_states_gc', polcmd: 'd', polpermissive: true },
        { polname: 'dialog_states_gc_select', polcmd: 'r', polpermissive: true },
        { polname: 'dialog_states_isolation', polcmd: '*', polpermissive: true },
      ]);

      const gcRoles = await check.query<{ roles: unknown }>(
        `SELECT COALESCE(ARRAY_AGG(r.rolname ORDER BY r.rolname), ARRAY[]::text[]) AS roles
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         LEFT JOIN pg_roles r ON r.oid = ANY (p.polroles)
         WHERE c.relname = 'dialog_states' AND p.polname = 'dialog_states_gc'`,
      );
      expect(JSON.stringify(gcRoles.rows[0]?.roles)).toContain('izicrm_maintenance');
    } finally {
      await check.end();
    }

    const maintenance = maintenancePool(db.cluster());
    try {
      const who = await maintenance.query<{ u: string }>(`SELECT current_user AS u`);
      expect(who.rows[0]?.u).toBe('izicrm_maintenance');

      const live = await maintenance.query(`DELETE FROM dialog_states WHERE user_id = $1`, [userId]);
      expect(live.rowCount).toBe(0);

      const expired = await maintenance.query(`DELETE FROM dialog_states WHERE user_id = $1`, [
        expiredUser,
      ]);
      expect(expired.rowCount).toBe(1);
    } finally {
      await maintenance.end();
    }
  });
});
