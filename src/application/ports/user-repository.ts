import type { UserId } from '../../domain/cards/card.js';

import type { DbTx } from './unit-of-work.js';

export type UserRecord = {
  id: UserId;
  telegramId: string;
  tz: string;
  languageCode: string | null;
};

/**
 * Таблица `users` изолируется по `telegram_id`, не по `user_id`.
 * Методы вызываются только внутри `withTelegramIdentity`.
 */
export interface UserRepository {
  findOrCreateByTelegramId(telegramId: string, tx: DbTx): Promise<UserRecord>;
  getUserByTelegramId(telegramId: string, tx: DbTx): Promise<UserRecord | null>;
}
