import type { CardRow } from '../ports/card-repository.js';
import { balanceAsOf, lastEntryDate, type Ledger } from '../../domain/finance/balance.js';
import { cardBalanceChange } from '../../domain/finance/card-change.js';
import { capitalAsOf, frozenCapitalAsOf, workingCapitalAsOf } from '../../domain/finance/capital.js';
import { isFrozen, isInScope, isWorking } from '../../domain/finance/card-scope.js';
import { monthStart, type BusinessDate } from '../../domain/finance/period.js';
import { dailyPnl, monthlyPnl } from '../../domain/finance/pnl.js';
import { Money } from '../../domain/money/money.js';
import type { UserId } from '../../domain/cards/card.js';

import type { Dashboard, DashboardCard } from '../dto/dashboard.js';

import { loadLedger, type ServiceDeps } from './support.js';

function monthOf(date: BusinessDate): { year: number; month: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
  };
}

function lastActivityDate(ledger: Ledger, today: BusinessDate): BusinessDate | null {
  let last = lastEntryDate(ledger);
  for (const card of ledger.cards) {
    if (card.archivedOn === null || card.archivedOn > today) {
      continue;
    }
    if (last === undefined || card.archivedOn > last) {
      last = card.archivedOn;
    }
  }
  return last ?? null;
}

function toDashboardCard(ledger: Ledger, card: CardRow, asOf: BusinessDate): DashboardCard {
  return {
    id: card.id,
    name: card.name,
    icon: card.icon,
    balance: balanceAsOf(ledger, card.id, asOf) ?? Money.zero(),
    change: cardBalanceChange(ledger, card, asOf),
  };
}

/**
 * Главный экран: капитал и P&L считаются в domain после чтения строк.
 *
 * @see docs/architecture.md §5.1
 * @see docs/financial-model.md §3.4, §5
 */
export class DashboardService {
  constructor(private readonly deps: ServiceDeps) {}

  async getDashboard(userId: UserId, today: BusinessDate): Promise<Dashboard> {
    const { year, month } = monthOf(today);
    const from = monthStart(year, month);
    return this.deps.uow.withUser(userId, async (tx) => {
      const ledger = await loadLedger(this.deps.reports, userId, from, today, tx);
      const lastUpdateDate = lastActivityDate(ledger, today);
      const working: DashboardCard[] = [];
      const frozen: DashboardCard[] = [];
      for (const card of ledger.cards) {
        if (isWorking(card, today)) {
          working.push(toDashboardCard(ledger, card, today));
        } else if (isInScope(card, today) && isFrozen(card)) {
          frozen.push(toDashboardCard(ledger, card, today));
        }
      }
      return {
        today,
        lastUpdateDate,
        workingCapital: workingCapitalAsOf(ledger, today),
        frozenCapital: frozenCapitalAsOf(ledger, today),
        totalCapital: capitalAsOf(ledger, today),
        daily: dailyPnl(ledger, today),
        monthly: monthlyPnl(ledger, year, month),
        workingCards: working,
        frozenCards: frozen,
      };
    });
  }
}
