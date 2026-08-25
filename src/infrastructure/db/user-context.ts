import type { PoolClient } from 'pg';

export const USER_ID_GUC = 'app.current_user_id';
export const TELEGRAM_ID_GUC = 'app.current_telegram_id';

/**
 * Выставляет `app.current_user_id` с `LOCAL` (третий аргумент `true`).
 * Вызывать только внутри открытой транзакции (`BEGIN`): иначе LOCAL действует
 * на один statement и следующий запрос на том же клиенте идёт без контекста.
 *
 * @see docs/database.md §5.3, ADR-008
 */
export async function setLocalUserId(client: PoolClient, userId: string): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', [USER_ID_GUC, userId]);
}

/**
 * Выставляет `app.current_telegram_id` с `LOCAL` — только таблица `users`.
 *
 * @see docs/database.md §5.1
 */
export async function setLocalTelegramId(client: PoolClient, telegramId: string): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', [TELEGRAM_ID_GUC, telegramId]);
}
