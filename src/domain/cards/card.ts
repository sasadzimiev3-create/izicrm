import type { BusinessDate } from '../finance/period.js';

export type UserId = number & { readonly __brand: 'UserId' };
export type CardId = number & { readonly __brand: 'CardId' };

export type ArchiveReason = 'WITHDRAWN' | 'TRANSFERRED' | 'LOST';

export function userId(value: number): UserId {
  return value as UserId;
}

export function cardId(value: number): CardId {
  return value as CardId;
}

/**
 * Карта (в UI — «материал»). Поля дат нужны `isInScope` / `isFrozen` / `deriveWithdrawal`.
 *
 * @see docs/financial-model.md §3.3, §4.2
 */
export type Card = {
  id: CardId;
  userId: UserId;
  name: string;
  createdOn: BusinessDate;
  frozenOn: BusinessDate | null;
} & (
  | { archivedOn: null; archiveReason: null }
  | { archivedOn: BusinessDate; archiveReason: ArchiveReason }
);
