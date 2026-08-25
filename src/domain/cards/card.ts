import { ValidationError } from '../errors.js';
import type { BusinessDate } from '../finance/period.js';

export type UserId = number & { readonly __brand: 'UserId' };
export type CardId = number & { readonly __brand: 'CardId' };

export type ArchiveReason = 'WITHDRAWN' | 'TRANSFERRED' | 'LOST';

/**
 * Внутренний IDENTITY. Не `telegram_id`: BIGINT из драйвера — строка,
 * `Number(telegram_id)` теряет точность выше `2^53 − 1`.
 */
function brandedPositiveId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError('Некорректный идентификатор');
  }
  return value;
}

export function userId(value: number): UserId {
  return brandedPositiveId(value) as UserId;
}

export function cardId(value: number): CardId {
  return brandedPositiveId(value) as CardId;
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
