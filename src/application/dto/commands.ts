import type { ArchiveReason, CardId } from '../../domain/cards/card.js';
import type { BusinessDate } from '../../domain/finance/period.js';
import type { Money } from '../../domain/money/money.js';

export type Applied<T> = { applied: true; value: T } | { applied: false };

export type CreateCardCommand = {
  name: string;
  amount: Money;
  icon?: string | null;
  createdOn: BusinessDate;
  idempotencyKey?: string;
};

export type UpdateBalanceCommand = {
  cardId: CardId;
  amount: Money;
  businessDate: BusinessDate;
  idempotencyKey?: string;
};

export type TopUpCommand = {
  cardId: CardId;
  newAmount: Money;
  businessDate: BusinessDate;
  idempotencyKey?: string;
};

export type SpendCommand = {
  cardId: CardId;
  newAmount: Money;
  businessDate: BusinessDate;
  idempotencyKey?: string;
};

export type FreezeCommand = {
  cardId: CardId;
  frozenOn: BusinessDate;
  idempotencyKey?: string;
};

export type UnfreezeCommand = {
  cardId: CardId;
  idempotencyKey?: string;
};

export type ArchiveCommand = {
  cardId: CardId;
  archivedOn: BusinessDate;
  reason: ArchiveReason;
  targetCardId?: CardId;
  idempotencyKey?: string;
};

export type ArchivePreview = {
  cardId: CardId;
  name: string;
  remainder: Money;
  /** FR-2.9: при нулевом остатке вопрос о судьбе денег не задаётся. */
  needsDisposition: boolean;
};
