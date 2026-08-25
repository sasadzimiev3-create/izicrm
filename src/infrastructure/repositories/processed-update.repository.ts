import type { ProcessedUpdateRepository } from '../../application/ports/processed-update-repository.js';
import type { DbTx } from '../../application/ports/unit-of-work.js';
import type { UserId } from '../../domain/cards/card.js';
import { userIdParam } from '../db/ids.js';
import { kyselyTx } from '../db/tx.js';

export class PgProcessedUpdateRepository implements ProcessedUpdateRepository {
  async claim(userId: UserId, updateId: string, tx: DbTx): Promise<boolean> {
    const row = await kyselyTx(tx)
      .insertInto('processed_updates')
      .values({
        update_id: updateId,
        user_id: userIdParam(userId),
      })
      .onConflict((oc) => oc.column('update_id').doNothing())
      .returning('update_id')
      .executeTakeFirst();
    return row !== undefined;
  }
}
