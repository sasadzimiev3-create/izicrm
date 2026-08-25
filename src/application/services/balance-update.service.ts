import type { CardId, UserId } from '../../domain/cards/card.js';
import type { LocfBalance } from '../ports/balance-repository.js';
import type { Card } from '../../domain/cards/card.js';
import { ValidationError } from '../../domain/errors.js';
import { isWorking } from '../../domain/finance/card-scope.js';
import type { BusinessDate } from '../../domain/finance/period.js';
import { Money } from '../../domain/money/money.js';
import type { BalanceEntrySource } from '../ports/balance-repository.js';

import type { Applied, UpdateBalanceCommand } from '../dto/commands.js';
import type { CardRow } from '../ports/card-repository.js';

import {
  locfForCard,
  once,
  requireActiveCard,
  type ServiceDeps,
} from './support.js';

/**
 * Потоки при обновлении баланса (C-26, П-8).
 * Первый ввод за дату — 0/0. Исправление в день создания правит депозит.
 * Исправление в другой день сохраняет уже записанные потоки.
 */
export function flowsForDailyUpdate(
  card: Card,
  locf: LocfBalance,
  newAmount: Money,
  date: BusinessDate,
): { capitalIn: Money; capitalOut: Money; source: BalanceEntrySource } {
  if (locf.effectiveDate !== date) {
    return { capitalIn: Money.zero(), capitalOut: Money.zero(), source: 'DAILY_UPDATE' };
  }
  if (card.createdOn === date && locf.capitalOut.isZero()) {
    if (newAmount.isNegative()) {
      throw new ValidationError('Некорректная сумма');
    }
    return { capitalIn: newAmount, capitalOut: Money.zero(), source: 'CORRECTION' };
  }
  return { capitalIn: locf.capitalIn, capitalOut: locf.capitalOut, source: 'CORRECTION' };
}

/**
 * Обновление баланса одной карты. Замороженные можно обновить по одной (C-27).
 * Очередь «все» — только незамороженные.
 *
 * @see docs/architecture.md §5.2
 */
export class BalanceUpdateService {
  constructor(private readonly deps: ServiceDeps) {}

  async listWorkingQueue(userId: UserId, date: BusinessDate): Promise<CardRow[]> {
    return this.deps.uow.withUser(userId, async (tx) => {
      const inScope = await this.deps.cards.listInScope(userId, date, tx);
      return inScope.filter((card) => isWorking(card, date));
    });
  }

  async update(userId: UserId, command: UpdateBalanceCommand): Promise<Applied<void>> {
    return this.deps.uow.withUser(userId, (tx) =>
      once(this.deps.processed, userId, command.idempotencyKey, tx, async () => {
        const card = await requireActiveCard(
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
        const flows = flowsForDailyUpdate(card, locf, command.amount, command.businessDate);
        await this.deps.balances.insertSuperseding(
          userId,
          {
            cardId: command.cardId,
            effectiveDate: command.businessDate,
            amount: command.amount,
            capitalIn: flows.capitalIn,
            capitalOut: flows.capitalOut,
            source: flows.source,
          },
          tx,
        );
      }),
    );
  }

  async previousBalance(
    userId: UserId,
    cardId: CardId,
    date: BusinessDate,
  ): Promise<{ card: CardRow; amount: Money }> {
    return this.deps.uow.withUser(userId, async (tx) => {
      const card = await requireActiveCard(this.deps.cards, userId, cardId, date, tx);
      const locf = await locfForCard(this.deps.balances, userId, cardId, date, tx);
      return { card, amount: locf.amount };
    });
  }
}
