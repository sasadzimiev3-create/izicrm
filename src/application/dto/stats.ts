import type { ArchiveReason, CardId } from '../../domain/cards/card.js';
import type { CardBalanceChange } from '../../domain/finance/card-change.js';
import type { BusinessDate } from '../../domain/finance/period.js';
import type { AllTimePnl, DailyPnl, PeriodPnl } from '../../domain/finance/pnl.js';
import type { Money } from '../../domain/money/money.js';
import type { PercentResult } from '../../domain/money/percent.js';
import type { BalanceEntrySource } from '../ports/balance-repository.js';

export type MaterialStatus = 'working' | 'frozen';

export type StatsMaterial = {
  id: CardId;
  name: string;
  status: MaterialStatus;
  balance: Money;
  change: CardBalanceChange;
  share: PercentResult;
};

export type CapitalPoint = {
  date: BusinessDate;
  capital: Money;
};

export type DailyPnlPoint = {
  date: BusinessDate;
  amount: Money;
  percent: PercentResult;
};

export type MonthlyPnlPoint = {
  year: number;
  month: number;
  amount: Money;
  percent: PercentResult;
};

export type JournalEntry = {
  cardId: CardId;
  cardName: string;
  effectiveDate: BusinessDate;
  amount: Money;
  capitalIn: Money;
  capitalOut: Money;
  source: BalanceEntrySource;
};

export type FlowEntry = {
  cardId: CardId;
  cardName: string;
  flowDate: BusinessDate;
  kind: 'DEPOSIT' | 'WITHDRAWAL';
  amount: Money;
};

export type ArchivedMaterial = {
  id: CardId;
  name: string;
  archivedOn: BusinessDate;
  archiveReason: ArchiveReason;
};

export type WindowKey = '1W' | '1M' | '3M' | '1Y' | 'All';

export type WindowPnl = {
  from: BusinessDate;
  to: BusinessDate;
  amount: Money;
  percent: PercentResult;
  closing: Money;
};

/**
 * Снимок кабинета: те же формулы, что Telegram и Excel (`periodPnl`).
 *
 * @see docs/financial-model.md §5
 */
export type StatsSnapshot = {
  today: BusinessDate;
  lastUpdateDate: BusinessDate | null;
  totalCapital: Money;
  workingCapital: Money;
  frozenCapital: Money;
  workingShare: PercentResult;
  daily: DailyPnl;
  monthly: PeriodPnl;
  allTime: AllTimePnl;
  materials: StatsMaterial[];
  capitalSeries: CapitalPoint[];
  dailyPnlSeries: DailyPnlPoint[];
  monthlySeries: MonthlyPnlPoint[];
  /** P&L окон обзора: те же `periodPnl`, без дополнительного запроса в БД. */
  windows: Record<WindowKey, WindowPnl>;
  journal: JournalEntry[];
  flows: FlowEntry[];
  archived: ArchivedMaterial[];
};
