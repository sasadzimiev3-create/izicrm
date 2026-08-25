import type {
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
import { toBalanceEntry } from './mappers.js';

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