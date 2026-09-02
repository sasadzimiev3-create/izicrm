import { sql } from 'kysely';

import type {
  JournalEntry,
  ReportQueryData,
  ReportQueryRepository,
} from '../../application/ports/report-query-repository.js';
import type { DbTx } from '../../application/ports/unit-of-work.js';
import type { UserId } from '../../domain/cards/card.js';
import type { BalanceEntry } from '../../domain/finance/balance.js';
import type { BusinessDate } from '../../domain/finance/period.js';
import { userIdParam } from '../db/ids.js';
import { kyselyTx } from '../db/tx.js';

import { PgCardRepository } from './card.repository.js';
import { toBalanceEntry, toJournalEntry } from './mappers.js';

export class PgReportQueryRepository implements ReportQueryRepository {
  readonly #cards = new PgCardRepository();

  /**
   * Только выборка строк: карты, актуальные записи, потоки. Без `SUM()` и без P&L.
   *
   * @see docs/excel-report.md §1
   */
  async loadUserHistory(
    userId: UserId,
    from: BusinessDate,
    to: BusinessDate,
    tx: DbTx,
  ): Promise<ReportQueryData> {
    const [cards, entries, flows] = await Promise.all([
      this.#cards.listUserCards(userId, tx),
      this.listCurrentEntries(userId, tx),
      this.#cards.flowsInRange(userId, from, to, tx),
    ]);
    return { cards, entries, flows };
  }

  async listUserJournal(userId: UserId, tx: DbTx): Promise<JournalEntry[]> {
    const result = await sql<{
      kind: string;
      at: Date;
      date: string | null;
      card_id: string;
      card_name: string;
      source: string | null;
      amount: string | null;
      capital_in: string | null;
      capital_out: string | null;
      archive_reason: string | null;
    }>`
      SELECT
        'BALANCE'::text AS kind,
        e.recorded_at AS at,
        e.effective_date::text AS date,
        e.card_id::text AS card_id,
        c.name AS card_name,
        e.source::text AS source,
        e.amount::text AS amount,
        e.capital_in::text AS capital_in,
        e.capital_out::text AS capital_out,
        NULL::text AS archive_reason
      FROM balance_entries e
      JOIN cards c ON c.id = e.card_id AND c.user_id = e.user_id
      WHERE e.user_id = ${userIdParam(userId)}

      UNION ALL

      SELECT
        CASE a.action
          WHEN 'CARD_FREEZE' THEN 'FREEZE'
          WHEN 'CARD_UNFREEZE' THEN 'UNFREEZE'
          WHEN 'CARD_ARCHIVE' THEN 'ARCHIVE'
        END AS kind,
        a.created_at AS at,
        NULL::text AS date,
        a.entity_id::text AS card_id,
        COALESCE(c.name, a.payload->>'name', '') AS card_name,
        a.action AS source,
        NULL::text AS amount,
        NULL::text AS capital_in,
        NULL::text AS capital_out,
        a.payload->>'reason' AS archive_reason
      FROM audit_log a
      LEFT JOIN cards c ON c.id = a.entity_id AND c.user_id = a.user_id
      WHERE a.user_id = ${userIdParam(userId)}
        AND a.action IN ('CARD_FREEZE', 'CARD_UNFREEZE', 'CARD_ARCHIVE')
        AND a.entity_id IS NOT NULL

      ORDER BY at DESC, card_id DESC
    `.execute(kyselyTx(tx));
    return result.rows.map((row) => toJournalEntry(row));
  }

  private async listCurrentEntries(userId: UserId, tx: DbTx): Promise<BalanceEntry[]> {
    const rows = await kyselyTx(tx)
      .selectFrom('v_current_balance_entries')
      .select(['card_id', 'amount', 'capital_in', 'capital_out', 'effective_date'])
      .where('user_id', '=', userIdParam(userId))
      .orderBy('effective_date')
      .orderBy('card_id')
      .execute();
    return rows.map((row) => toBalanceEntry(row));
  }
}