import { cardId, userId, type CardId, type UserId } from '../../domain/cards/card.js';

/** IDENTITY из драйвера — строка; внутренние id остаются в safe integer. */
export function parseUserId(value: string): UserId {
  return userId(Number(value));
}

export function parseCardId(value: string): CardId {
  return cardId(Number(value));
}

export function userIdParam(id: UserId): string {
  return String(id);
}

export function cardIdParam(id: CardId): string {
  return String(id);
}
