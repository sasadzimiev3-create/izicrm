import { loadEnv } from './config/env.js';
import { createTelegramDeps } from './bootstrap.js';
import { assertApplicationRole, createPool } from './infrastructure/db/pool.js';
import { createDataAccess } from './infrastructure/db/data-access.js';
import { createTelegramBot } from './infrastructure/telegram/bot.js';
import { registerTelegramHandlers } from './interface/telegram/handlers/register.js';
import { startHealthServer } from './infrastructure/ops/health.js';
import { createInFlightGate, ShutdownInProgressError, trackUnitOfWork } from './infrastructure/ops/inflight.js';
import { assertMigrationsApplied } from './infrastructure/ops/migrations.js';
import { bindStopSignals, finalizeRuntime } from './infrastructure/ops/shutdown.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const token = env.TELEGRAM_BOT_TOKEN;
  if (token === undefined || token === '') {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  const pool = createPool(env.DATABASE_URL);
  await assertApplicationRole(pool);
  await assertMigrationsApplied(pool);

  const gate = createInFlightGate();
  const access = createDataAccess(pool);
  const deps = createTelegramDeps({ ...access, uow: trackUnitOfWork(access.uow, gate) });
  const bot = createTelegramBot(token);
  bot.use(async (_ctx, next) => {
    if (!gate.isAccepting()) {
      return;
    }
    try {
      await gate.run(() => next());
    } catch (error) {
      if (error instanceof ShutdownInProgressError) {
        return;
      }
      throw error;
    }
  });
  registerTelegramHandlers(bot, deps);

  const health = await startHealthServer(
    { appPool: pool, migrationsPool: pool },
    { host: env.HEALTH_HOST, port: env.HEALTH_PORT },
  );

  bindStopSignals(bot, gate);
  await bot.start();
  await finalizeRuntime({ bot, pool, health, gate });
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
