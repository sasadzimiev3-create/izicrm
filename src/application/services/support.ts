import type { BalanceRepository, LocfBalance } from '../ports/balance-repository.js';
import type { CardRepository, CardRow } from '../ports/card-repository.js';
import type { ProcessedUpdateRepository } from '../ports/processed-update-repository.js';
import type { ReportQueryRepository } from '../ports/report-query-repository.js';
import type { DbTx, UnitOfWork } from '../ports/unit-of-work.js';
import type { CardId, UserId } from '../../domain/cards/card.js';
import { NotFoundError, ValidationError } from '../../domain/errors.js';
import type { Ledger } from '../../domain/finance/balance.js';
import { isFrozen, isInScope } from '../../domain/finance/card-scope.js';
import type { BusinessDate } from '../../domain/finance/period.js';

export type ServiceDeps = {
  uow: UnitOfWork;
  cards: CardRepository;
  balances: BalanceRepository;
  reports: ReportQueryRepository;
  processed: ProcessedUpdateRepository;
};

export const NOT_FOUND = 'Материал не найден';

export async function once<T>(
  processed: ProcessedUpdateRepository,
  userId: UserId,
  key: string | undefined,
  tx: DbTx,
  work: () => Promise<T>,
): Promise<{ applied: true; value: T } | { applied: false }> {
  if (key !== undefined) {
    const claimed = await processed.claim(userId, key, tx);
    if (!claimed) {
      return { applied: false };
    }
  }
  return { applied: true, value: await work() };
}

export async function requireUserCard(
  cards: CardRepository,
  userId: UserId,
  cardId: CardId,
  tx: DbTx,
): Promise<CardRow> {
  const card = await cards.getUserCard(userId, cardId, tx);
  if (card === null) {
    throw new NotFoundError(NOT_FOUND);
  }
  return card;
}

/** Активная (неархивная) карта пользователя. Чужой и отсутствующий id — одинаковый ответ. */
export async function requireActiveCard(
  cards: CardRepository,
  userId: UserId,
  cardId: CardId,
  date: BusinessDate,
  tx: DbTx,
): Promise<CardRow> {
  const card = await requireUserCard(cards, userId, cardId, tx);
  if (!isInScope(card, date)) {
    throw new NotFoundError(NOT_FOUND);
  }
  return card;
}

export async function requireWorkingCard(
  cards: CardRepository,
  userId: UserId,
  cardId: CardId,
  date: BusinessDate,
  tx: DbTx,
): Promise<CardRow> {
  const card = await requireActiveCard(cards, userId, cardId, date, tx);
  if (isFrozen(card)) {
    throw new ValidationError('Замороженный материал пополнить нельзя');
  }
  return card;
}

export async function locfForCard(
  balances: BalanceRepository,
  userId: UserId,
  cardId: CardId,
  date: BusinessDate,
  tx: DbTx,
): Promise<LocfBalance> {
  const snapshot = await balances.locfSnapshot(userId, date, tx);
  const row = snapshot.find((entry) => entry.cardId === cardId);
  if (row === undefined) {
    throw new NotFoundError(NOT_FOUND);
  }
  return row;
}

export async function loadLedger(
  reports: ReportQueryRepository,
  userId: UserId,
  from: BusinessDate,
  to: BusinessDate,
  tx: DbTx,
): Promise<{ cards: CardRow[]; entries: Ledger['entries'] }> {
  const history = await reports.loadUserHistory(userId, from, to, tx);
  return { cards: history.cards, entries: history.entries };
}
