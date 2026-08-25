import type { ArchiveReason, Card, CardId, UserId } from '../../domain/cards/card.js';
import type { BusinessDate } from '../../domain/finance/period.js';
import type { Money } from '../../domain/money/money.js';

import type { DbTx } from './unit-of-work.js';

/** Карта плюс декоративный стикер — в доменном `Card` иконки нет. */
export type CardRow = Card & { icon: string | null };

export type CapitalFlowRow = {
  cardId: CardId;
  flowDate: BusinessDate;
  kind: 'DEPOSIT' | 'WITHDRAWAL';
  amount: Money;
};

export type InsertCardInput = {
  name: string;
  createdOn: BusinessDate;
  icon: string | null;
};

export interface CardRepository {
  getUserCard(userId: UserId, cardId: CardId, tx: DbTx): Promise<CardRow | null>;
  listInScope(userId: UserId, date: BusinessDate, tx: DbTx): Promise<CardRow[]>;
  listFrozen(userId: UserId, date: BusinessDate, tx: DbTx): Promise<CardRow[]>;
  listArchived(userId: UserId, tx: DbTx): Promise<CardRow[]>;
  listUserCards(userId: UserId, tx: DbTx): Promise<CardRow[]>;
  findActiveByNormalizedName(userId: UserId, nameNorm: string, tx: DbTx): Promise<CardRow | null>;
  insertUserCard(userId: UserId, input: InsertCardInput, tx: DbTx): Promise<CardRow>;
  renameUserCard(userId: UserId, cardId: CardId, name: string, tx: DbTx): Promise<void>;
  setUserCardIcon(userId: UserId, cardId: CardId, icon: string | null, tx: DbTx): Promise<void>;
  freezeUserCard(userId: UserId, cardId: CardId, frozenOn: BusinessDate, tx: DbTx): Promise<void>;
  unfreezeUserCard(userId: UserId, cardId: CardId, tx: DbTx): Promise<void>;
  archiveUserCard(
    userId: UserId,
    cardId: CardId,
    archivedOn: BusinessDate,
    reason: ArchiveReason,
    tx: DbTx,
  ): Promise<void>;
  flowsInRange(
    userId: UserId,
    from: BusinessDate,
    to: BusinessDate,
    tx: DbTx,
  ): Promise<CapitalFlowRow[]>;
}
