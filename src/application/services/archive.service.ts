import type { CardId, UserId } from '../../domain/cards/card.js';
import { ValidationError } from '../../domain/errors.js';
import { isInScope } from '../../domain/finance/card-scope.js';
import type { BusinessDate } from '../../domain/finance/period.js';
import { Money } from '../../domain/money/money.js';
import type { DbTx } from '../ports/unit-of-work.js';

import type { Applied, ArchiveCommand, ArchivePreview } from '../dto/commands.js';
import type { CardRow } from '../ports/card-repository.js';

import { locfForCard, once, requireActiveCard, type ServiceDeps } from './support.js';

/**
 * Удаление материала = архивирование. Три ненулевые ветви: перевод, вывод, потеря.
 * Перевод остатка — в одной транзакции с архивированием (C-17, T-9).
 */
export class ArchiveService {
  constructor(private readonly deps: ServiceDeps) {}

  async preview(userId: UserId, cardId: CardId, date: BusinessDate): Promise<ArchivePreview> {
    return this.deps.uow.withUser(userId, async (tx) => {
      const card = await requireActiveCard(this.deps.cards, userId, cardId, date, tx);
      const locf = await locfForCard(this.deps.balances, userId, cardId, date, tx);
      return {
        cardId: card.id,
        name: card.name,
        remainder: locf.amount,
        needsDisposition: !locf.amount.isZero(),
      };
    });
  }

  async listTransferTargets(
    userId: UserId,
    sourceCardId: CardId,
    date: BusinessDate,
  ): Promise<CardRow[]> {
    return this.deps.uow.withUser(userId, async (tx) => {
      await requireActiveCard(this.deps.cards, userId, sourceCardId, date, tx);
      const inScope = await this.deps.cards.listInScope(userId, date, tx);
      return inScope.filter((card) => card.id !== sourceCardId && isInScope(card, date));
    });
  }

  async archive(userId: UserId, command: ArchiveCommand): Promise<Applied<void>> {
    return this.deps.uow.withUser(userId, (tx) =>
      once(this.deps.processed, userId, command.idempotencyKey, tx, async () => {
        await requireActiveCard(
          this.deps.cards,
          userId,
          command.cardId,
          command.archivedOn,
          tx,
        );
        const locf = await locfForCard(
          this.deps.balances,
          userId,
          command.cardId,
          command.archivedOn,
          tx,
        );

        if (locf.amount.isZero()) {
          await this.deps.cards.archiveUserCard(
            userId,
            command.cardId,
            command.archivedOn,
            'WITHDRAWN',
            tx,
          );
          return;
        }

        if (command.reason === 'TRANSFERRED') {
          await this.transferRemainder(userId, command, locf.amount, tx);
        }

        await this.deps.cards.archiveUserCard(
          userId,
          command.cardId,
          command.archivedOn,
          command.reason,
          tx,
        );
      }),
    );
  }

  private async transferRemainder(
    userId: UserId,
    command: ArchiveCommand,
    remainder: Money,
    tx: DbTx,
  ): Promise<void> {
    const targetId = command.targetCardId;
    if (targetId === undefined) {
      throw new ValidationError('Нужна карта-получатель');
    }
    if (targetId === command.cardId) {
      throw new ValidationError('Нельзя перевести на ту же карту');
    }
    await requireActiveCard(this.deps.cards, userId, targetId, command.archivedOn, tx);
    const targetLocf = await locfForCard(
      this.deps.balances,
      userId,
      targetId,
      command.archivedOn,
      tx,
    );
    const hasToday = targetLocf.effectiveDate === command.archivedOn;
    await this.deps.balances.insertSuperseding(
      userId,
      {
        cardId: targetId,
        effectiveDate: command.archivedOn,
        amount: targetLocf.amount.plus(remainder),
        capitalIn: hasToday ? targetLocf.capitalIn : Money.zero(),
        capitalOut: hasToday ? targetLocf.capitalOut : Money.zero(),
        source: 'ARCHIVE_TRANSFER_IN',
      },
      tx,
    );
  }
}
