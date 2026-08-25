import path from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterEach, beforeAll, beforeEach } from 'vitest';

import { loadEnv } from '../../src/config/env.js';
import { createPool } from '../../src/infrastructure/db/pool.js';
import {
  setLocalTelegramId,
  setLocalUserId,
} from '../../src/infrastructure/db/user-context.js';

export const APP_PASSWORD = 'app_secret';
export const MIGRATOR_PASSWORD = 'migrator_secret';
export const MAINTENANCE_PASSWORD = 'maintenance_secret';

const IMAGE = 'postgres:17-alpine';
const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

export type StartedCluster = {
  container: StartedPostgreSqlContainer;
  adminUrl: string;
  appUrl: string;
  migratorUrl: string;
  maintenanceUrl: string;
};

let shared: Promise<StartedCluster> | undefined;

export function pgCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

export async function expectPgCode(action: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (pgCode(error) === code) {
      return;
    }
    throw error;
  }
  throw new Error(`expected PostgreSQL error ${code}, but the statement succeeded`);
}

function withUserinfo(adminUrl: string, username: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = username;
  url.password = password;
  return url.toString();
}

export async function migrate(databaseUrl: string, direction: 'up' | 'down', count?: number): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction,
    migrationsTable: 'pgmigrations',
    ...(count === undefined ? {} : { count }),
    checkOrder: true,
    verbose: false,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: (msg: string) => {
        console.error(msg);
      },
    },
  });
}

async function setRolePasswords(adminUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`ALTER ROLE izicrm_app PASSWORD '${APP_PASSWORD}'`);
    await client.query(`ALTER ROLE izicrm_migrator PASSWORD '${MIGRATOR_PASSWORD}'`);
    await client.query(`ALTER ROLE izicrm_maintenance PASSWORD '${MAINTENANCE_PASSWORD}'`);
  } finally {
    await client.end();
  }
}

export async function startCluster(): Promise<StartedCluster> {
  const container = await new PostgreSqlContainer(IMAGE)
    .withDatabase('izicrm')
    .withUsername('postgres')
    .withPassword('postgres')
    .withStartupTimeout(120_000)
    .start();

  const adminUrl = container.getConnectionUri();
  await migrate(adminUrl, 'up');
  await setRolePasswords(adminUrl);

  const cluster: StartedCluster = {
    container,
    adminUrl,
    appUrl: withUserinfo(adminUrl, 'izicrm_app', APP_PASSWORD),
    migratorUrl: withUserinfo(adminUrl, 'izicrm_migrator', MIGRATOR_PASSWORD),
    maintenanceUrl: withUserinfo(adminUrl, 'izicrm_maintenance', MAINTENANCE_PASSWORD),
  };

  loadEnv({
    DATABASE_URL: cluster.appUrl,
    DATABASE_MIGRATOR_URL: cluster.migratorUrl,
    DATABASE_MAINTENANCE_URL: cluster.maintenanceUrl,
    TZ: 'Europe/Moscow',
  });

  await container.snapshot();
  return cluster;
}

export function getSharedCluster(): Promise<StartedCluster> {
  shared ??= startCluster();
  return shared;
}

export async function restoreCluster(cluster: StartedCluster): Promise<void> {
  await cluster.container.restoreSnapshot();
}

export function appPool(cluster: StartedCluster): pg.Pool {
  return createPool(cluster.appUrl);
}

export function adminPool(cluster: StartedCluster): pg.Pool {
  return createPool(cluster.adminUrl);
}

export function maintenancePool(cluster: StartedCluster): pg.Pool {
  return createPool(cluster.maintenanceUrl);
}

export async function insertUser(pool: pg.Pool, telegramId: string): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setLocalTelegramId(client, telegramId);
    const result = await client.query<{ id: string }>(
      'INSERT INTO users (telegram_id) VALUES ($1) RETURNING id',
      [telegramId],
    );
    await client.query('COMMIT');
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error('INSERT users returned no id');
    }
    return id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function withUser<T>(
  pool: pg.Pool,
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setLocalUserId(client, userId);
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function insertCard(
  pool: pg.Pool,
  userId: string,
  name: string,
  createdOn: string,
): Promise<string> {
  return withUser(pool, userId, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO cards (user_id, name, created_on) VALUES ($1, $2, $3::date) RETURNING id`,
      [userId, name, createdOn],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error('INSERT cards returned no id');
    }
    return id;
  });
}

export async function insertBalance(
  pool: pg.Pool,
  args: {
    userId: string;
    cardId: string;
    effectiveDate: string;
    amount: string;
    capitalIn?: string;
    capitalOut?: string;
    source?: string;
  },
): Promise<string> {
  return withUser(pool, args.userId, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO balance_entries (
         user_id, card_id, effective_date, amount, capital_in, capital_out, source
       ) VALUES ($1, $2, $3::date, $4, $5, $6, $7::balance_entry_source)
       RETURNING id`,
      [
        args.userId,
        args.cardId,
        args.effectiveDate,
        args.amount,
        args.capitalIn ?? '0',
        args.capitalOut ?? '0',
        args.source ?? 'CARD_CREATED',
      ],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error('INSERT balance_entries returned no id');
    }
    return id;
  });
}

export async function archiveCard(
  pool: pg.Pool,
  userId: string,
  cardId: string,
  archivedOn: string,
  reason: 'WITHDRAWN' | 'TRANSFERRED' | 'LOST',
): Promise<void> {
  await withUser(pool, userId, async (client) => {
    await client.query(
      `UPDATE cards
       SET archived_on = $2::date,
           archived_at = now(),
           archive_reason = $3::archive_reason,
           frozen_on = NULL,
           frozen_at = NULL
       WHERE id = $1`,
      [cardId, archivedOn, reason],
    );
  });
}

export async function freezeCard(
  pool: pg.Pool,
  userId: string,
  cardId: string,
  frozenOn: string,
): Promise<void> {
  await withUser(pool, userId, async (client) => {
    await client.query(
      `UPDATE cards SET frozen_on = $2::date, frozen_at = now() WHERE id = $1`,
      [cardId, frozenOn],
    );
  });
}

export function useAppDb(): {
  cluster: () => StartedCluster;
  pool: () => pg.Pool;
} {
  let cluster: StartedCluster;
  let pool: pg.Pool;

  beforeAll(async () => {
    cluster = await getSharedCluster();
  }, 180_000);

  beforeEach(async () => {
    await restoreCluster(cluster);
    pool = appPool(cluster);
  });

  afterEach(async () => {
    await pool.end();
  });

  return {
    cluster: () => cluster,
    pool: () => pool,
  };
}
