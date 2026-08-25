import type { DbTx } from '../../application/ports/unit-of-work.js';
import type { UserRecord, UserRepository } from '../../application/ports/user-repository.js';
import { kyselyTx } from '../db/tx.js';

import { toUserRecord } from './mappers.js';

export class PgUserRepository implements UserRepository {
  async getUserByTelegramId(telegramId: string, tx: DbTx): Promise<UserRecord | null> {
    const row = await kyselyTx(tx)
      .selectFrom('users')
      .select(['id', 'telegram_id', 'tz', 'language_code'])
      .where('telegram_id', '=', telegramId)
      .executeTakeFirst();
    return row === undefined ? null : toUserRecord(row);
  }

  async findOrCreateByTelegramId(telegramId: string, tx: DbTx): Promise<UserRecord> {
    const existing = await this.getUserByTelegramId(telegramId, tx);
    if (existing !== null) {
      return existing;
    }
    const row = await kyselyTx(tx)
      .insertInto('users')
      .values({ telegram_id: telegramId, tz: 'Europe/Moscow' })
      .returning(['id', 'telegram_id', 'tz', 'language_code'])
      .executeTakeFirstOrThrow();
    return toUserRecord(row);
  }

  async markUserBlocked(telegramId: string, tx: DbTx): Promise<void> {
    await kyselyTx(tx)
      .updateTable('users')
      .set({ blocked_at: new Date() })
      .where('telegram_id', '=', telegramId)
      .execute();
  }
}
