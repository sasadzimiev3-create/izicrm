import type { CardId, UserId } from '../../domain/cards/card.js';
import type { LocfBalance } from '../ports/balance-repository.js';
import { isFrozen, isInScope, isWorking } from '../../domain/finance/card-scope.js';
import { NotFoundError } from '../../domain/errors.js';
import type { BusinessDate } from '../../domain/finance/period.js';
import { Money } from '../../domain/money/money.js';
import type { BalanceEntrySource } from '../ports/balance-repository.js';

import type { Applied, UpdateBalanceCommand } from '../dto/commands.js';
import type { CardRow } from '../ports/card-repository.js';

import {
  locfForCard,
  lockUserCards,
  NOT_FOUND,
  once,
  requireActiveCard,
  requireUserCard,
  type ServiceDeps,
} from './support.js';

/**
 * Потоки при обновлении баланса (C-26, П-8).
 * Первый ввод за дату — 0/0. Разница нового и предыдущего баланса — P&L:
 * депозит создания не переписывается. Исправление в тот же день сохраняет
 * уже записанные потоки (пополнение/трата).
 */
export function flowsForDailyUpdate(
  locf: LocfBalance,
  date: BusinessDate,
): { capitalIn: Money; capitalOut: Money; source: BalanceEntrySource } {
  if (locf.effectiveDate !== date) {
    return { capitalIn: Money.zero(), capitalOut: Money.zero(), source: 'DAILY_UPDATE' };
  }
  return { capitalIn: locf.capitalIn, capitalOut: locf.capitalOut, source: 'CORRECTION' };
}

export type UpdateQueueCard =
  | { kind: 'ready'; card: CardRow; amount: Money }
  | { kind: 'skip'; name: string; previous: string };

/**
 * Обновление баланса одной карты. Замороженные можно обновить по одной (C-27).
 * Очередь «все» — только незамороженные; карта, ушедшая из работы во время прохода, пропускается.
 *
 * @see docs/architecture.md §5.2
 * @see docs/telegram-flows.md §6
 */
export class BalanceUpdateService {
  constructor(private readonly deps: ServiceDeps) {}

  async listWorkingQueue(userId: UserId, date: BusinessDate): Promise<CardRow[]> {
    return this.deps.uow.withUser(userId, async (tx) => {
      const inScope = await this.deps.cards.listInScope(userId, date, tx);
      return inScope.filter((card) => isWorking(card, date));
    });
  }

  /**
   * Состояние карты в очереди обновления. Для прохода «все» (`queueLength > 1`)
   * замороженная или архивная карта — `skip`. Для одной карты архив — ошибка.
   */
  async inspectQueueCard(
    userId: UserId,
    cardId: CardId,
    date: BusinessDate,
    queueLength: number,
  ): Promise<UpdateQueueCard> {
    return this.deps.uow.withUser(userId, async (tx) => {
      const card = await requireUserCard(this.deps.cards, userId, cardId, tx);
      const skippable = queueLength > 1;
      if (!isInScope(card, date) || (skippable && isFrozen(card))) {
        if (!skippable) {
          throw new NotFoundError(NOT_FOUND);
        }
        return { kind: 'skip', name: card.name, previous: '0.00' };
      }
      const locf = await locfForCard(this.deps.balances, userId, cardId, date, tx);
      return { kind: 'ready', card, amount: locf.amount };
    });
  }

  async update(userId: UserId, command: UpdateBalanceCommand): Promise<Applied<void>> {
    return this.deps.uow.withUser(userId, (tx) =>
      once(this.deps.processed, userId, command.idempotencyKey, tx, async () => {
        await lockUserCards(this.deps.cards, userId, [command.cardId], tx);
        const card = await requireActiveCard(
          this.deps.cards,
          userId,
          command.cardId,
          command.businessDate,
          tx,
        );
        if (command.workingOnly === true && isFrozen(card)) {
          return;
        }
        const locf = await locfForCard(
          this.deps.balances,
          userId,
          command.cardId,
          command.businessDate,
          tx,
        );
        const flows = flowsForDailyUpdate(locf, command.businessDate);
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
