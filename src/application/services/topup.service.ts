import type { UserId } from '../../domain/cards/card.js';
import { isWorking } from '../../domain/finance/card-scope.js';
import { topUpDelta } from '../../domain/finance/flows.js';
import type { BusinessDate } from '../../domain/finance/period.js';
import { Money } from '../../domain/money/money.js';

import type { Applied, TopUpCommand } from '../dto/commands.js';
import type { CardRow } from '../ports/card-repository.js';

import { locfForCard, once, requireWorkingCard, type ServiceDeps } from './support.js';

/**
 * Пополнение: новый баланс `Y >` текущего, `capital_in += Δ` (C-26, T-10).
 * Замороженный пополнить нельзя (FR-8.5).
 */
export class TopUpService {
  constructor(private readonly deps: ServiceDeps) {}

  async listTopUpable(userId: UserId, date: BusinessDate): Promise<CardRow[]> {
    return this.deps.uow.withUser(userId, async (tx) => {
      const inScope = await this.deps.cards.listInScope(userId, date, tx);
      return inScope.filter((card) => isWorking(card, date));
    });
  }

  async topUp(userId: UserId, command: TopUpCommand): Promise<Applied<{ delta: Money }>> {
    return this.deps.uow.withUser(userId, (tx) =>
      once(this.deps.processed, userId, command.idempotencyKey, tx, async () => {
        await requireWorkingCard(
          this.deps.cards,
          userId,
          command.cardId,
          command.businessDate,
          tx,
        );
        const locf = await locfForCard(
          this.deps.balances,
          userId,
          command.cardId,
          command.businessDate,
          tx,
        );
        const delta = topUpDelta(locf.amount, command.newAmount);
        const hasToday = locf.effectiveDate === command.businessDate;
        const capitalIn = (hasToday ? locf.capitalIn : Money.zero()).plus(delta);
        const capitalOut = hasToday ? locf.capitalOut : Money.zero();
        await this.deps.balances.insertSuperseding(
          userId,
          {
            cardId: command.cardId,
            effectiveDate: command.businessDate,
            amount: command.newAmount,
            capitalIn,
            capitalOut,
            source: 'TOP_UP',
          },
          tx,
        );
        return { delta };
      }),
    );
  }
}
