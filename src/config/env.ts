import { z } from 'zod';

function portNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('HEALTH_PORT must be an integer 1–65535');
  }
  return parsed;
}

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATOR_URL: z.string().min(1),
  DATABASE_MAINTENANCE_URL: z.string().min(1),
  DATABASE_ADMIN_URL: z.string().min(1).optional(),
  TZ: z.string().min(1).default('Europe/Moscow'),
  HEALTH_HOST: z.string().min(1).default('127.0.0.1'),
  HEALTH_PORT: z.string().default('8080').transform(portNumber),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Разбор переменных окружения. Первый потребитель — подключение к БД (этап 3).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
