import { sql } from 'kysely';

import type { ProcessedUpdateRepository } from '../../application/ports/processed-update-repository.js';
import type { DbTx } from '../../application/ports/unit-of-work.js';
import type { UserId } from '../../domain/cards/card.js';
import { userIdParam } from '../db/ids.js';
import { kyselyTx } from '../db/tx.js';

export class PgProcessedUpdateRepository implements ProcessedUpdateRepository {
  async claim(
    userId: UserId,
    updateId: string,
    tx: DbTx,
    pending = false,
  ): Promise<boolean> {
    const uid = userIdParam(userId);
    const result = pending
      ? await sql<{ update_id: string }>`
          INSERT INTO processed_updates (update_id, user_id, completed)
          VALUES (${updateId}, ${uid}, false)
          ON CONFLICT (update_id) DO UPDATE
            SET processed_at = now()
          WHERE processed_updates.completed = false
            AND processed_updates.user_id = ${uid}
          RETURNING update_id
        `.execute(kyselyTx(tx))
      : await sql<{ update_id: string }>`
          INSERT INTO processed_updates (update_id, user_id, completed)
          VALUES (${updateId}, ${uid}, true)
          ON CONFLICT (update_id) DO NOTHING
          RETURNING update_id
        `.execute(kyselyTx(tx));
    return result.rows[0] !== undefined;
  }

  async complete(userId: UserId, updateId: string, tx: DbTx): Promise<void> {
    await sql`
      UPDATE processed_updates
      SET completed = true
      WHERE update_id = ${updateId}
        AND user_id = ${userIdParam(userId)}
        AND completed = false
    `.execute(kyselyTx(tx));
  }
}
