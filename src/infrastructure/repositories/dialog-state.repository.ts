import { sql } from 'kysely';

import type {
  DialogStateRecord,
  DialogStateRepository,
  UpsertDialogStateInput,
} from '../../application/ports/dialog-state-repository.js';
import type { DbTx } from '../../application/ports/unit-of-work.js';
import type { UserId } from '../../domain/cards/card.js';
import { userIdParam } from '../db/ids.js';
import { kyselyTx } from '../db/tx.js';

import { toDialogStateRecord } from './mappers.js';

export class PgDialogStateRepository implements DialogStateRepository {
  async getUserDialogState(userId: UserId, tx: DbTx): Promise<DialogStateRecord | null> {
    const row = await kyselyTx(tx)
      .selectFrom('dialog_states')
      .select(['user_id', 'state', 'payload', 'business_date', 'state_rev', 'expires_at'])
      .where('user_id', '=', userIdParam(userId))
      .executeTakeFirst();
    return row === undefined ? null : toDialogStateRecord(row);
  }

  async consumeUserDialogRev(
    userId: UserId,
    expectedRev: number,
    tx: DbTx,
  ): Promise<'missing' | 'stale' | number> {
    const bumped = await kyselyTx(tx)
      .updateTable('dialog_states')
      .set({
        state_rev: sql`dialog_states.state_rev + 1`,
        updated_at: sql`now()`,
      })
      .where('user_id', '=', userIdParam(userId))
      .where('state_rev', '=', expectedRev)
      .returning(['state_rev'])
      .executeTakeFirst();
    if (bumped !== undefined) {
      return bumped.state_rev;
    }
    const existing = await this.getUserDialogState(userId, tx);
    return existing === null ? 'missing' : 'stale';
  }

  async restoreUserDialogRev(
    userId: UserId,
    fromRev: number,
    toRev: number,
    tx: DbTx,
  ): Promise<void> {
    await kyselyTx(tx)
      .updateTable('dialog_states')
      .set({
        state_rev: toRev,
        updated_at: sql`now()`,
      })
      .where('user_id', '=', userIdParam(userId))
      .where('state_rev', '=', fromRev)
      .execute();
  }

  async upsertUserDialogState(
    userId: UserId,
    input: UpsertDialogStateInput,
    tx: DbTx,
  ): Promise<DialogStateRecord> {
    const row = await kyselyTx(tx)
      .insertInto('dialog_states')
      .values({
        user_id: userIdParam(userId),
        state: input.state,
        payload: input.payload,
        business_date: input.businessDate,
        expires_at: input.expiresAt,
      })
      .onConflict((oc) =>
        oc.column('user_id').doUpdateSet({
          state: input.state,
          payload: input.payload,
          business_date: input.businessDate,
          expires_at: input.expiresAt,
          state_rev: sql`dialog_states.state_rev + 1`,
          updated_at: sql`now()`,
        }),
      )
      .returning(['user_id', 'state', 'payload', 'business_date', 'state_rev', 'expires_at'])
      .executeTakeFirstOrThrow();
    return toDialogStateRecord(row);
  }

  async clearUserDialogState(userId: UserId, tx: DbTx): Promise<void> {
    await kyselyTx(tx)
      .updateTable('dialog_states')
      .set({
        state: 'Idle',
        payload: {},
        business_date: null,
        state_rev: sql`dialog_states.state_rev + 1`,
        updated_at: sql`now()`,
      })
      .where('user_id', '=', userIdParam(userId))
      .execute();
  }
}
