import { sql, type Kysely } from 'kysely';

import type { DbTx, UnitOfWork } from '../../application/ports/unit-of-work.js';
import type { UserId } from '../../domain/cards/card.js';

import { userIdParam } from './ids.js';
import { asDbTx } from './tx.js';
import type { Database } from './types.js';

/**
 * Транзакция + `SET LOCAL` для RLS. Третий аргумент `set_config` — `true` (LOCAL):
 * контекст не переживает COMMIT и не утекает в пул (ADR-008).
 *
 * @see docs/database.md §5.3
 */
export class PgUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Kysely<Database>) {}

  async withUser<T>(userId: UserId, work: (tx: DbTx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.current_user_id', ${userIdParam(userId)}, true)`.execute(trx);
      return work(asDbTx(trx));
    });
  }

  async withTelegramIdentity<T>(telegramId: string, work: (tx: DbTx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.current_telegram_id', ${telegramId}, true)`.execute(trx);
      return work(asDbTx(trx));
    });
  }
}
