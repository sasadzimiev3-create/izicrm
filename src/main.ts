import { loadEnv } from './config/env.js';
import { createTelegramDeps } from './bootstrap.js';
import { assertApplicationRole, createPool } from './infrastructure/db/pool.js';
import { createDataAccess } from './infrastructure/db/data-access.js';
import { createTelegramBot } from './infrastructure/telegram/bot.js';
import { registerTelegramHandlers } from './interface/telegram/handlers/register.js';
import { createWebAuth } from './interface/web/auth.js';
import { defaultPublicDir, startWebServer } from './interface/web/server.js';
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
  const tracked = { ...access, uow: trackUnitOfWork(access.uow, gate) };
  const publicUrl =
    env.WEB_PUBLIC_URL === undefined || env.WEB_PUBLIC_URL === '' ? null : env.WEB_PUBLIC_URL;
  const authSecret = env.WEB_SESSION_SECRET === undefined || env.WEB_SESSION_SECRET === '' ? token : env.WEB_SESSION_SECRET;
  const auth = createWebAuth({ secret: authSecret, publicUrl, botToken: token });
  const deps = createTelegramDeps(tracked, {
    webCabinet: {
      issueLoginUrl(userId, telegramId) {
        return auth.issueLoginUrl(userId, telegramId);
      },
    },
  });
  const bot = createTelegramBot(token, { proxyUrl: env.TELEGRAM_PROXY_URL });
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
  const webDeps = {
    services: deps.services,
    uow: deps.uow,
    users: deps.users,
    clock: deps.clock,
    logger: deps.logger,
    auth,
    publicDir: defaultPublicDir(),
    botUsername: null as string | null,
  };
  const web = await startWebServer(webDeps, { host: env.WEB_HOST, port: env.WEB_PORT });
  console.error(`web :${String(web.port)}`);

  while (gate.isAccepting()) {
    try {
      const me = await bot.api.getMe();
      webDeps.botUsername = me.username ?? null;
      console.error(`telegram polling as @${me.username}`);
      await bot.start();
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      console.error(`telegram connect failed, retry in 5s: ${message}`);
      await delay(5_000);
    }
  }

  await finalizeRuntime({ bot, pool, health, web, gate });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
