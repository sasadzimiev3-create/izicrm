import { sql } from 'kysely';

import type {
  CapitalFlowRow,
  CardRepository,
  CardRow,
  InsertCardInput,
} from '../../application/ports/card-repository.js';
import type { DbTx } from '../../application/ports/unit-of-work.js';
import type { ArchiveReason, CardId, UserId } from '../../domain/cards/card.js';
import type { BusinessDate } from '../../domain/finance/period.js';
import { cardIdParam, userIdParam } from '../db/ids.js';
import { rethrowUniqueAsConflict } from '../db/pg-error.js';
import { kyselyTx } from '../db/tx.js';

import { toCapitalFlowRow, toCardRow } from './mappers.js';

const CARD_COLUMNS = [
  'id',
  'user_id',
  'name',
  'icon',
  'created_on',
  'frozen_on',
  'archived_on',
  'archive_reason',
] as const;

export class PgCardRepository implements CardRepository {
  async getUserCard(userId: UserId, cardId: CardId, tx: DbTx): Promise<CardRow | null> {
    const row = await kyselyTx(tx)
      .selectFrom('cards')
      .select(CARD_COLUMNS)
      .where('user_id', '=', userIdParam(userId))
      .where('id', '=', cardIdParam(cardId))
      .executeTakeFirst();
    return row === undefined ? null : toCardRow(row);
  }

  async listInScope(userId: UserId, date: BusinessDate, tx: DbTx): Promise<CardRow[]> {
    const rows = await kyselyTx(tx)
      .selectFrom('cards')
      .select(CARD_COLUMNS)
      .where('user_id', '=', userIdParam(userId))
      .where('created_on', '<=', date)
      .where((eb) => eb.or([eb('archived_on', 'is', null), eb('archived_on', '>', date)]))
      .orderBy('name_norm')
      .execute();
    return rows.map((row) => toCardRow(row));
  }

  async listFrozen(userId: UserId, date: BusinessDate, tx: DbTx): Promise<CardRow[]> {
    const rows = await kyselyTx(tx)
      .selectFrom('cards')
      .select(CARD_COLUMNS)
      .where('user_id', '=', userIdParam(userId))
      .where('frozen_on', 'is not', null)
      .where('created_on', '<=', date)
      .where((eb) => eb.or([eb('archived_on', 'is', null), eb('archived_on', '>', date)]))
      .orderBy('name_norm')
      .execute();
    return rows.map((row) => toCardRow(row));
  }

  async listArchived(userId: UserId, tx: DbTx): Promise<CardRow[]> {
    const rows = await kyselyTx(tx)
      .selectFrom('cards')
      .select(CARD_COLUMNS)
      .where('user_id', '=', userIdParam(userId))
      .where('archived_on', 'is not', null)
      .orderBy('archived_on', 'desc')
      .execute();
    return rows.map((row) => toCardRow(row));
  }

  async listUserCards(userId: UserId, tx: DbTx): Promise<CardRow[]> {
    const rows = await kyselyTx(tx)
      .selectFrom('cards')
      .select(CARD_COLUMNS)
      .where('user_id', '=', userIdParam(userId))
      .orderBy('name_norm')
      .execute();
    return rows.map((row) => toCardRow(row));
  }

  async findActiveByNormalizedName(
    userId: UserId,
    nameNorm: string,
    tx: DbTx,
  ): Promise<CardRow | null> {
    const row = await kyselyTx(tx)
      .selectFrom('cards')
      .select(CARD_COLUMNS)
      .where('user_id', '=', userIdParam(userId))
      .where('name_norm', '=', nameNorm)
      .where('archived_on', 'is', null)
      .executeTakeFirst();
    return row === undefined ? null : toCardRow(row);
  }

  async insertUserCard(userId: UserId, input: InsertCardInput, tx: DbTx): Promise<CardRow> {
    try {
      const row = await kyselyTx(tx)
        .insertInto('cards')
        .values({
          user_id: userIdParam(userId),
          name: input.name,
          created_on: input.createdOn,
          icon: input.icon,
        })
        .returning(CARD_COLUMNS)
        .executeTakeFirstOrThrow();
      return toCardRow(row);
    } catch (error) {
      rethrowUniqueAsConflict(error);
    }
  }

  async renameUserCard(userId: UserId, cardId: CardId, name: string, tx: DbTx): Promise<void> {
    try {
      await kyselyTx(tx)
        .updateTable('cards')
        .set({ name })
        .where('user_id', '=', userIdParam(userId))
        .where('id', '=', cardIdParam(cardId))
        .execute();
    } catch (error) {
      rethrowUniqueAsConflict(error);
    }
  }

  async setUserCardIcon(
    userId: UserId,
    cardId: CardId,
    icon: string | null,
    tx: DbTx,
  ): Promise<void> {
    await kyselyTx(tx)
      .updateTable('cards')
      .set({ icon })
      .where('user_id', '=', userIdParam(userId))
      .where('id', '=', cardIdParam(cardId))
      .execute();
  }

  async freezeUserCard(
    userId: UserId,
    cardId: CardId,
    frozenOn: BusinessDate,
    tx: DbTx,
  ): Promise<void> {
    await sql`
      UPDATE cards
      SET frozen_on = ${frozenOn}::date, frozen_at = now()
      WHERE user_id = ${userIdParam(userId)} AND id = ${cardIdParam(cardId)}
    `.execute(kyselyTx(tx));
  }

  async unfreezeUserCard(userId: UserId, cardId: CardId, tx: DbTx): Promise<void> {
    await kyselyTx(tx)
      .updateTable('cards')
      .set({ frozen_on: null, frozen_at: null })
      .where('user_id', '=', userIdParam(userId))
      .where('id', '=', cardIdParam(cardId))
      .execute();
  }

  async archiveUserCard(
    userId: UserId,
    cardId: CardId,
    archivedOn: BusinessDate,
    reason: ArchiveReason,
    tx: DbTx,
  ): Promise<void> {
    await sql`
      UPDATE cards
      SET archived_on = ${archivedOn}::date,
          archived_at = now(),
          archive_reason = ${reason}::archive_reason,
          frozen_on = NULL,
          frozen_at = NULL
      WHERE user_id = ${userIdParam(userId)} AND id = ${cardIdParam(cardId)}
    `.execute(kyselyTx(tx));
  }

  /**
   * Потоки за период. SQL выбирает строки, без `SUM()` (NFR-11).
   *
   * @see docs/database.md §6.3
   */
  async flowsInRange(
    userId: UserId,
    from: BusinessDate,
    to: BusinessDate,
    tx: DbTx,
  ): Promise<CapitalFlowRow[]> {
    const result = await sql<{
      card_id: string;
      flow_date: string;
      kind: 'DEPOSIT' | 'WITHDRAWAL';
      amount: string;
    }>`
      SELECT card_id, flow_date, kind, amount
      FROM v_capital_flows
      WHERE user_id = ${userIdParam(userId)} AND flow_date BETWEEN ${from} AND ${to}
    `.execute(kyselyTx(tx));
    return result.rows.map((row) => toCapitalFlowRow(row));
  }
}