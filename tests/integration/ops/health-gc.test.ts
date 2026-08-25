import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createPool } from '../../../src/infrastructure/db/pool.js';
import { assertMigrationsApplied, expectedMigrationNames } from '../../../src/infrastructure/ops/migrations.js';
import { probeHealth, startHealthServer } from '../../../src/infrastructure/ops/health.js';
import { adminPool, insertUser, migrate, useAppDb, withUser } from '../harness.js';

function statementsOf(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const GC_SQL = readFileSync(path.join(process.cwd(), 'deploy/gc.sql'), 'utf8');

describe('health-check и миграции', () => {
  const db = useAppDb();

  it('отвечает 200, когда база доступна и миграции применены', async () => {
    const pool = db.pool();
    await assertMigrationsApplied(pool);
    const probe = await probeHealth({ appPool: pool, migrationsPool: pool });
    expect(probe).toEqual({ ok: true, db: true, migrations: true });

    const server = await startHealthServer(
      { appPool: pool, migrationsPool: pool },
      { host: '127.0.0.1', port: 0 },
    );
    try {
      const response = await fetch(`http://127.0.0.1:${String(server.port)}/health`);
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(body).toEqual({ ok: true, db: true, migrations: true });
    } finally {
      await server.close();
    }
  });

  it('не поднимается и отдаёт 503, если миграции не применены', async () => {
    const cluster = db.cluster();
    await migrate(cluster.adminUrl, 'down', 1);
    const pool = db.pool();
    const admin = adminPool(cluster);
    try {
      await expect(assertMigrationsApplied(admin)).rejects.toThrow(/migrations not applied/);
    } finally {
      await admin.end();
    }

    const server = await startHealthServer(
      { appPool: pool, migrationsPool: pool },
      { host: '127.0.0.1', port: 0 },
    );
    try {
      const response = await fetch(`http://127.0.0.1:${String(server.port)}/health`);
      expect(response.status).toBe(503);
      const body = (await response.json()) as { ok: boolean; migrations: boolean };
      expect(body.ok).toBe(false);
      expect(body.migrations).toBe(false);
    } finally {
      await server.close();
      await migrate(cluster.adminUrl, 'up');
    }
  });

  it('каталог миграций совпадает с pgmigrations', async () => {
    const applied = await db.pool().query<{ name: string }>(`SELECT name FROM pgmigrations ORDER BY name`);
    expect(applied.rows.map((row) => row.name)).toEqual(expectedMigrationNames());
  });
});

describe('регламент очистки izicrm_maintenance', () => {
  const db = useAppDb();

  it('удаляет просроченное и не трогает живой диалог', async () => {
    const pool = db.pool();
    const liveUser = await insertUser(pool, '18001');
    const expiredUser = await insertUser(pool, '18002');
    const oldUpdateUser = await insertUser(pool, '18003');
    const freshUpdateUser = await insertUser(pool, '18004');

    await withUser(pool, liveUser, async (client) => {
      await client.query(
        `INSERT INTO dialog_states (user_id, state, expires_at)
         VALUES ($1, 'Idle', now() + interval '1 hour')`,
        [liveUser],
      );
    });
    await withUser(pool, expiredUser, async (client) => {
      await client.query(
        `INSERT INTO dialog_states (user_id, state, expires_at)
         VALUES ($1, 'Idle', TIMESTAMPTZ '2000-01-01 00:00:00+00')`,
        [expiredUser],
      );
    });
    await withUser(pool, oldUpdateUser, async (client) => {
      await client.query(
        `INSERT INTO processed_updates (update_id, user_id, processed_at)
         VALUES (18003, $1, now() - interval '8 days')`,
        [oldUpdateUser],
      );
    });
    await withUser(pool, freshUpdateUser, async (client) => {
      await client.query(
        `INSERT INTO processed_updates (update_id, user_id, processed_at)
         VALUES (18004, $1, now())`,
        [freshUpdateUser],
      );
    });

    const maintenance = createPool(db.cluster().maintenanceUrl);
    try {
      for (const statement of statementsOf(GC_SQL)) {
        await maintenance.query(statement);
      }
    } finally {
      await maintenance.end();
    }

    const admin = adminPool(db.cluster());
    try {
      const dialogs = await admin.query<{ user_id: string }>(
        `SELECT user_id FROM dialog_states ORDER BY user_id`,
      );
      expect(dialogs.rows.map((row) => row.user_id)).toEqual([liveUser]);

      const updates = await admin.query<{ update_id: string }>(
        `SELECT update_id FROM processed_updates ORDER BY update_id`,
      );
      expect(updates.rows.map((row) => row.update_id)).toEqual(['18004']);
    } finally {
      await admin.end();
    }
  });
});
