import { expect } from 'vitest';

import { cardId, userId, type ArchiveReason, type Card } from '../../../src/domain/cards/card.js';
import { Money } from '../../../src/domain/money/money.js';
import type { BalanceEntry, Ledger } from '../../../src/domain/finance/balance.js';
import { parseBusinessDate, type BusinessDate } from '../../../src/domain/finance/period.js';

export const USER = userId(1);

export function d(iso: string): BusinessDate {
  return parseBusinessDate(iso);
}

export function rub(amount: string): Money {
  return Money.from(amount);
}

export function expectMoney(amount: Money, expected: string): void {
  expect(amount.toFixed()).toBe(Money.from(expected).toFixed());
}

export function makeCard(params: {
  id: number;
  createdOn: string;
  name?: string;
  frozenOn?: string | null;
  archivedOn?: string | null;
  archiveReason?: ArchiveReason | null;
}): Card {
  const base = {
    id: cardId(params.id),
    userId: USER,
    name: params.name ?? `Card ${String(params.id)}`,
    createdOn: d(params.createdOn),
    frozenOn: params.frozenOn == null ? null : d(params.frozenOn),
  };
  if (params.archivedOn == null) {
    return { ...base, archivedOn: null, archiveReason: null };
  }
  return {
    ...base,
    archivedOn: d(params.archivedOn),
    archiveReason: params.archiveReason ?? 'WITHDRAWN',
  };
}

export function makeEntry(
  card: number,
  date: string,
  amount: string,
  capitalIn = '0',
  capitalOut = '0',
): BalanceEntry {
  return {
    cardId: cardId(card),
    effectiveDate: d(date),
    amount: rub(amount),
    capitalIn: rub(capitalIn),
    capitalOut: rub(capitalOut),
  };
}

export function makeLedger(cards: readonly Card[], entries: readonly BalanceEntry[]): Ledger {
  return { cards, entries };
}
