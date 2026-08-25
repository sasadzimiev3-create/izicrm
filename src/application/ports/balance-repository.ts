import type { CardId, UserId } from '../../domain/cards/card.js';
import type { BusinessDate } from '../../domain/finance/period.js';
import type { Money } from '../../domain/money/money.js';

import type { DbTx } from './unit-of-work.js';

export type BalanceEntrySource =
  | 'CARD_CREATED'
  | 'DAILY_UPDATE'
  | 'TOP_UP'
  | 'SPEND'
  | 'CORRECTION'
  | 'ARCHIVE_TRANSFER_IN'
  | 'ARCHIVE_ZERO_OUT';

/**
 * Строка LOCF-снимка. Суммирование — в domain, не в SQL (NFR-11).
 *
 * @see docs/database.md §6.1
 */
export type LocfBalance = {
  cardId: CardId;
  amount: Money;
  capitalIn: Money;
  capitalOut: Money;
  effectiveDate: BusinessDate;
};

export type InsertBalanceInput = {
  cardId: CardId;
  effectiveDate: BusinessDate;
  amount: Money;
  capitalIn: Money;
  capitalOut: Money;
  source: BalanceEntrySource;
};

export interface BalanceRepository {
  locfSnapshot(userId: UserId, date: BusinessDate, tx: DbTx): Promise<LocfBalance[]>;
  previousUpdateDate(userId: UserId, date: BusinessDate, tx: DbTx): Promise<BusinessDate | null>;
  insertSuperseding(userId: UserId, input: InsertBalanceInput, tx: DbTx): Promise<void>;
}
