import http from 'node:http';

import type pg from 'pg';

import { assertMigrationsApplied, defaultMigrationsDir } from './migrations.js';

export type HealthProbe = {
  ok: boolean;
  db: boolean;
  migrations: boolean;
};

export type HealthDeps = {
  appPool: pg.Pool;
  migrationsPool: pg.Pool;
  migrationsDir?: string;
};

/**
 * Доступность БД под `izicrm_app` и применённость миграций.
 *
 * @see docs/architecture.md §7
 */
export async function probeHealth(deps: HealthDeps): Promise<HealthProbe> {
  const dir = deps.migrationsDir ?? defaultMigrationsDir();
  let db = false;
  let migrations = false;
  try {
    await deps.appPool.query('SELECT 1');
    db = true;
  } catch {
    db = false;
  }
  if (db) {
    try {
      await assertMigrationsApplied(deps.migrationsPool, dir);
      migrations = true;
    } catch {
      migrations = false;
    }
  }
  return { ok: db && migrations, db, migrations };
}

export type HealthServer = {
  port: number;
  close(): Promise<void>;
};

export function startHealthServer(
  deps: HealthDeps,
  options: { host?: string; port?: number } = {},
): Promise<HealthServer> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8080;
  const server = http.createServer((req, res) => {
    void handleHealthRequest(deps, req, res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      const bound =
        typeof address === 'object' && address !== null ? address.port : port;
      resolve({
        port: bound,
        close() {
          return new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          });
        },
      });
    });
  });
}

async function handleHealthRequest(
  deps: HealthDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (req.method !== 'GET' || (req.url !== '/health' && req.url !== '/health/')) {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const probe = await probeHealth(deps);
  res.statusCode = probe.ok ? 200 : 503;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(probe));
}
