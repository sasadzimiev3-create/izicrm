import type { UserId } from '../../domain/cards/card.js';
import { isInScope } from '../../domain/finance/card-scope.js';
import { spendDelta } from '../../domain/finance/flows.js';
import type { BusinessDate } from '../../domain/finance/period.js';
import { Money } from '../../domain/money/money.js';

import type { Applied, SpendCommand } from '../dto/commands.js';
import type { CardRow } from '../ports/card-repository.js';

import { locfForCard, once, requireActiveCard, type ServiceDeps } from './support.js';

/**
 * Трата без удаления: `Y <` текущего, `capital_out += Δ` (C-30, T-12).
 * Доступна и для замороженного; карта не архивируется при `Y = 0`.
 */
export class SpendService {
  constructor(private readonly deps: ServiceDeps) {}

  async listSpendable(userId: UserId, date: BusinessDate): Promise<CardRow[]> {
    return this.deps.uow.withUser(userId, async (tx) => {
      const inScope = await this.deps.cards.listInScope(userId, date, tx);
      return inScope.filter((card) => isInScope(card, date));
    });
  }

  async spend(userId: UserId, command: SpendCommand): Promise<Applied<{ delta: Money }>> {
    return this.deps.uow.withUser(userId, (tx) =>
      once(this.deps.processed, userId, command.idempotencyKey, tx, async () => {
        await requireActiveCard(
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
        const delta = spendDelta(locf.amount, command.newAmount);
        const hasToday = locf.effectiveDate === command.businessDate;
        const capitalIn = hasToday ? locf.capitalIn : Money.zero();
        const capitalOut = (hasToday ? locf.capitalOut : Money.zero()).plus(delta);
        await this.deps.balances.insertSuperseding(
          userId,
          {
            cardId: command.cardId,
            effectiveDate: command.businessDate,
            amount: command.newAmount,
            capitalIn,
            capitalOut,
            source: 'SPEND',
          },
          tx,
        );
        return { delta };
      }),
    );
  }
}
