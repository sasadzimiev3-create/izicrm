import { loadEnv } from './config/env.js';
import { createTelegramDeps } from './bootstrap.js';
import { assertApplicationRole, createPool } from './infrastructure/db/pool.js';
import { createDataAccess } from './infrastructure/db/data-access.js';
import { createTelegramBot } from './infrastructure/telegram/bot.js';
import { registerTelegramHandlers } from './interface/telegram/handlers/register.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const token = env.TELEGRAM_BOT_TOKEN;
  if (token === undefined || token === '') {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  const pool = createPool(env.DATABASE_URL);
  await assertApplicationRole(pool);
  const access = createDataAccess(pool);
  const deps = createTelegramDeps(access);
  const bot = createTelegramBot(token);
  registerTelegramHandlers(bot, deps);
  await bot.start();
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
