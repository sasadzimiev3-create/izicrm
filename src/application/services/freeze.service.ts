import type { UserId } from '../../domain/cards/card.js';
import { NotFoundError, ValidationError } from '../../domain/errors.js';
import { isFrozen, isWorking } from '../../domain/finance/card-scope.js';
import type { BusinessDate } from '../../domain/finance/period.js';

import type { Applied, FreezeCommand, UnfreezeCommand } from '../dto/commands.js';
import type { CardRow } from '../ports/card-repository.js';

import { NOT_FOUND, once, requireActiveCard, requireUserCard, type ServiceDeps } from './support.js';

/**
 * Заморозка и разморозка. Капитал и P&L не меняются (T-11, C-27).
 */
export class FreezeService {
  constructor(private readonly deps: ServiceDeps) {}

  async listFreezable(userId: UserId, date: BusinessDate): Promise<CardRow[]> {
    return this.deps.uow.withUser(userId, async (tx) => {
      const inScope = await this.deps.cards.listInScope(userId, date, tx);
      return inScope.filter((card) => isWorking(card, date));
    });
  }

  async freeze(userId: UserId, command: FreezeCommand): Promise<Applied<void>> {
    return this.deps.uow.withUser(userId, (tx) =>
      once(this.deps.processed, userId, command.idempotencyKey, tx, async () => {
        const card = await requireActiveCard(
          this.deps.cards,
          userId,
          command.cardId,
          command.frozenOn,
          tx,
        );
        if (isFrozen(card)) {
          throw new ValidationError('Материал уже заморожен');
        }
        await this.deps.cards.freezeUserCard(userId, command.cardId, command.frozenOn, tx);
      }),
    );
  }

  async unfreeze(userId: UserId, command: UnfreezeCommand): Promise<Applied<void>> {
    return this.deps.uow.withUser(userId, (tx) =>
      once(this.deps.processed, userId, command.idempotencyKey, tx, async () => {
        const card = await requireUserCard(this.deps.cards, userId, command.cardId, tx);
        if (card.archivedOn !== null) {
          throw new NotFoundError(NOT_FOUND);
        }
        if (!isFrozen(card)) {
          throw new ValidationError('Материал не заморожен');
        }
        await this.deps.cards.unfreezeUserCard(userId, command.cardId, tx);
      }),
    );
  }
}
