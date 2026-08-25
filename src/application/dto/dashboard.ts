import type { CardId } from '../../domain/cards/card.js';
import type { CardBalanceChange } from '../../domain/finance/card-change.js';
import type { BusinessDate } from '../../domain/finance/period.js';
import type { DailyPnl, PeriodPnl } from '../../domain/finance/pnl.js';
import type { Money } from '../../domain/money/money.js';
import type { PercentResult } from '../../domain/money/percent.js';

export type DashboardCard = {
  id: CardId;
  name: string;
  icon: string | null;
  balance: Money;
  change: CardBalanceChange;
};

export type Dashboard = {
  today: BusinessDate;
  lastUpdateDate: BusinessDate | null;
  workingCapital: Money;
  frozenCapital: Money;
  totalCapital: Money;
  daily: DailyPnl;
  monthly: PeriodPnl;
  workingCards: DashboardCard[];
  frozenCards: DashboardCard[];
};

export type { CardBalanceChange, DailyPnl, PeriodPnl, PercentResult };
