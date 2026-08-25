import { GrammyError } from 'grammy';

/**
 * Telegram 403: пользователь заблокировал бота.
 *
 * @see docs/telegram-flows.md §6
 */
export function isBotBlockedError(error: unknown): boolean {
  return error instanceof GrammyError && error.error_code === 403;
}
