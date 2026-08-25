import path from 'node:path';

import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { z } from 'zod';

const bootstrapSchema = z.object({
  DATABASE_ADMIN_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATOR_URL: z.string().min(1),
  DATABASE_MAINTENANCE_URL: z.string().min(1),
});

function passwordOf(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).password);
}

async function waitForPostgres(connectionString: string, attempts = 30): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      last = error;
      try {
        await client.end();
      } catch {
        /* already closed */
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    }
  }
  throw last instanceof Error ? last : new Error('postgres did not become ready');
}

async function applyMigrations(adminUrl: string): Promise<void> {
  await runner({
    databaseUrl: adminUrl,
    dir: path.join(process.cwd(), 'migrations'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    checkOrder: true,
    verbose: true,
  });
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Первое применение миграций требует CREATEROLE (суперпользователь).
 * Пароли ролей в SQL нет — их выставляет оператор после 0001.
 */
async function setRolePasswords(adminUrl: string, env: z.infer<typeof bootstrapSchema>): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`ALTER ROLE izicrm_app PASSWORD ${quoteLiteral(passwordOf(env.DATABASE_URL))}`);
    await client.query(
      `ALTER ROLE izicrm_migrator PASSWORD ${quoteLiteral(passwordOf(env.DATABASE_MIGRATOR_URL))}`,
    );
    await client.query(
      `ALTER ROLE izicrm_maintenance PASSWORD ${quoteLiteral(passwordOf(env.DATABASE_MAINTENANCE_URL))}`,
    );
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const env = bootstrapSchema.parse(process.env);
  await waitForPostgres(env.DATABASE_ADMIN_URL);
  await applyMigrations(env.DATABASE_ADMIN_URL);
  await setRolePasswords(env.DATABASE_ADMIN_URL, env);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
