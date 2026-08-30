import { sql } from 'kysely';

import type {
  JournalEntry,
  ReportQueryData,
  ReportQueryRepository,
} from '../../application/ports/report-query-repository.js';
import type { BalanceEntrySource } from '../../application/ports/balance-repository.js';
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
      card_id: string;
      name: string;
      effective_date: string;
      amount: string;
      capital_in: string;
      capital_out: string;
      source: BalanceEntrySource;
    }>`
      SELECT e.card_id, c.name, e.effective_date, e.amount, e.capital_in, e.capital_out, e.source
      FROM v_current_balance_entries e
      JOIN cards c ON c.id = e.card_id AND c.user_id = e.user_id
      WHERE e.user_id = ${userIdParam(userId)}
      ORDER BY e.effective_date DESC, e.card_id DESC
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