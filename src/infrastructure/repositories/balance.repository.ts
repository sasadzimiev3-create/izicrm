import { sql } from 'kysely';

import type {
  BalanceRepository,
  InsertBalanceInput,
  LocfBalance,
} from '../../application/ports/balance-repository.js';
import type { DbTx } from '../../application/ports/unit-of-work.js';
import type { UserId } from '../../domain/cards/card.js';
import { parseBusinessDate, type BusinessDate } from '../../domain/finance/period.js';
import { cardIdParam, userIdParam } from '../db/ids.js';
import { kyselyTx } from '../db/tx.js';

import { toLocfBalance } from './mappers.js';

export class PgBalanceRepository implements BalanceRepository {
  /**
   * LOCF-снимок на дату: последняя актуальная запись каждой карты в scope.
   * Возвращает строки; суммирование — в domain (NFR-11).
   *
   * @see docs/database.md §6.1
   */
  async locfSnapshot(userId: UserId, date: BusinessDate, tx: DbTx): Promise<LocfBalance[]> {
    const result = await sql<{
      card_id: string;
      amount: string;
      capital_in: string;
      capital_out: string;
      effective_date: string;
    }>`
      SELECT DISTINCT ON (e.card_id) e.card_id, e.amount, e.capital_in, e.capital_out, e.effective_date
      FROM v_current_balance_entries e
      JOIN cards c ON c.id = e.card_id
      WHERE e.user_id = ${userIdParam(userId)}
        AND e.effective_date <= ${date}
        AND c.created_on <= ${date}
        AND (c.archived_on IS NULL OR c.archived_on > ${date})
      ORDER BY e.card_id, e.effective_date DESC
    `.execute(kyselyTx(tx));
    return result.rows.map((row) => toLocfBalance(row));
  }

  /**
   * @see docs/database.md §6.2
   */
  async previousUpdateDate(userId: UserId, date: BusinessDate, tx: DbTx): Promise<BusinessDate | null> {
    const result = await sql<{ prev_date: string | null }>`
      SELECT max(effective_date)::text AS prev_date
      FROM v_current_balance_entries
      WHERE user_id = ${userIdParam(userId)} AND effective_date < ${date}
    `.execute(kyselyTx(tx));
    const prev = result.rows[0]?.prev_date;
    if (prev === undefined || prev === null) {
      return null;
    }
    return parseBusinessDate(prev);
  }

  /**
   * Исправление за ту же дату: сначала вытеснение актуальной строки, затем вставка.
   * Порядок обратный тексту §6.4: частичный unique-индекс проверяется сразу при INSERT,
   * поэтому вставка «поверх» ещё актуальной записи даёт 23505. CTE ссылается на
   * `superseded`, чтобы UPDATE закончился до INSERT. `superseded_by = id` — как в
   * проверенном сценарии схемы: FK требует уже существующий id, а триггер не даёт
   * поменять `superseded_by` после первой записи.
   *
   * @see docs/database.md §6.4
   */
  async insertSuperseding(userId: UserId, input: InsertBalanceInput, tx: DbTx): Promise<void> {
    await sql`
      WITH superseded AS (
        UPDATE balance_entries be
        SET superseded_at = now(), superseded_by = be.id
        WHERE be.user_id = ${userIdParam(userId)}
          AND be.card_id = ${cardIdParam(input.cardId)}
          AND be.effective_date = ${input.effectiveDate}::date
          AND be.superseded_at IS NULL
        RETURNING be.id
      )
      INSERT INTO balance_entries (
        user_id, card_id, effective_date, amount, capital_in, capital_out, source
      )
      SELECT
        ${userIdParam(userId)}::bigint,
        ${cardIdParam(input.cardId)}::bigint,
        ${input.effectiveDate}::date,
        ${input.amount.toFixed()}::numeric,
        ${input.capitalIn.toFixed()}::numeric,
        ${input.capitalOut.toFixed()}::numeric,
        ${input.source}::balance_entry_source
      FROM (SELECT count(*) FROM superseded) AS _gate
    `.execute(kyselyTx(tx));
  }
}
