import type { UserId } from '../../domain/cards/card.js';
import type { BalanceEntry } from '../../domain/finance/balance.js';
import type { BusinessDate } from '../../domain/finance/period.js';

import type { CapitalFlowRow, CardRow } from './card-repository.js';
import type { DbTx } from './unit-of-work.js';

/**
 * Выгрузка строк для Excel. Формул P&L здесь нет (NFR-8).
 *
 * @see docs/excel-report.md §1
 */
export type ReportQueryData = {
  cards: CardRow[];
  entries: BalanceEntry[];
  flows: CapitalFlowRow[];
};

export interface ReportQueryRepository {
  loadUserHistory(userId: UserId, from: BusinessDate, to: BusinessDate, tx: DbTx): Promise<ReportQueryData>;
}
