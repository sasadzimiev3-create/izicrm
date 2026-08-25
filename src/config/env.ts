import { z } from 'zod';

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATOR_URL: z.string().min(1),
  DATABASE_MAINTENANCE_URL: z.string().min(1),
  TZ: z.string().min(1).default('Europe/Moscow'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Разбор переменных окружения. Первый потребитель — подключение к БД (этап 3).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
