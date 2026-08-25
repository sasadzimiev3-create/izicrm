import type { CardRow } from '../ports/card-repository.js';
import { normalizeCardName } from '../../domain/cards/card-name.js';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/errors.js';
import { Money } from '../../domain/money/money.js';
import type { CardId, UserId } from '../../domain/cards/card.js';

import type { Applied, CreateCardCommand, RenameCardCommand, SetCardIconCommand } from '../dto/commands.js';
import { assertCardIcon } from '../dto/card-icon.js';

import { NOT_FOUND, once, requireUserCard, type ServiceDeps } from './support.js';

const NAME_MAX = 64;

export function assertCardName(name: string): void {
  const length = [...name].length;
  if (length < 1 || length > NAME_MAX || normalizeCardName(name) === '') {
    throw new ValidationError('Название должно быть от 1 до 64 символов');
  }
}

/**
 * Создание, переименование и стикер карты. Стартовый баланс — всегда депозит (C-29).
 */
export class CardService {
  constructor(private readonly deps: ServiceDeps) {}

  async create(userId: UserId, command: CreateCardCommand): Promise<Applied<CardRow>> {
    assertCardName(command.name);
    const icon = assertCardIcon(command.icon);
    if (command.amount.isNegative()) {
      throw new ValidationError('Некорректная сумма');
    }
    return this.deps.uow.withUser(userId, (tx) =>
      once(this.deps.processed, userId, command.idempotencyKey, tx, async () => {
        const duplicate = await this.deps.cards.findActiveByNormalizedName(
          userId,
          normalizeCardName(command.name),
          tx,
        );
        if (duplicate !== null) {
          throw new ConflictError('Материал с таким названием уже есть');
        }
        const card = await this.deps.cards.insertUserCard(
          userId,
          { name: command.name, createdOn: command.createdOn, icon },
          tx,
        );
        await this.deps.balances.insertSuperseding(
          userId,
          {
            cardId: card.id,
            effectiveDate: command.createdOn,
            amount: command.amount,
            capitalIn: command.amount,
            capitalOut: Money.zero(),
            source: 'CARD_CREATED',
          },
          tx,
        );
        return card;
      }),
    );
  }

  async rename(userId: UserId, command: RenameCardCommand): Promise<Applied<void>> {
    assertCardName(command.name);
    return this.deps.uow.withUser(userId, (tx) =>
      once(this.deps.processed, userId, command.idempotencyKey, tx, async () => {
        const card = await requireUserCard(this.deps.cards, userId, command.cardId, tx);
        if (card.archivedOn !== null) {
          throw new NotFoundError(NOT_FOUND);
        }
        const duplicate = await this.deps.cards.findActiveByNormalizedName(
          userId,
          normalizeCardName(command.name),
          tx,
        );
        if (duplicate !== null && duplicate.id !== card.id) {
          throw new ConflictError('Материал с таким названием уже есть');
        }
        await this.deps.cards.renameUserCard(userId, command.cardId, command.name, tx);
      }),
    );
  }

  async setIcon(userId: UserId, command: SetCardIconCommand): Promise<Applied<void>> {
    const icon = assertCardIcon(command.icon);
    return this.deps.uow.withUser(userId, (tx) =>
      once(this.deps.processed, userId, command.idempotencyKey, tx, async () => {
        const card = await requireUserCard(this.deps.cards, userId, command.cardId, tx);
        if (card.archivedOn !== null) {
          throw new NotFoundError(NOT_FOUND);
        }
        await this.deps.cards.setUserCardIcon(userId, command.cardId, icon, tx);
      }),
    );
  }

  async getUserCard(userId: UserId, cardId: CardId): Promise<CardRow | null> {
    return this.deps.uow.withUser(userId, (tx) => this.deps.cards.getUserCard(userId, cardId, tx));
  }

  async listArchived(userId: UserId): Promise<CardRow[]> {
    return this.deps.uow.withUser(userId, (tx) => this.deps.cards.listArchived(userId, tx));
  }
}
