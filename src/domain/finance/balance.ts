import type { Card, CardId } from '../cards/card.js';
import { Money } from '../money/money.js';
import { compareDates, type BusinessDate } from './period.js';

/**
 * Актуальная (не вытесненная) запись баланса. В домен попадают только строки
 * с `superseded_at IS NULL` — вытесненные отфильтровывает вызывающий слой.
 *
 * @see docs/financial-model.md §3.1
 */
export type BalanceEntry = {
  cardId: CardId;
  effectiveDate: BusinessDate;
  amount: Money;
  capitalIn: Money;
  capitalOut: Money;
};

/**
 * Снимок **одного** пользователя: карты и актуальные записи.
 * Репозиторий уже скоупит по `user_id`. Смешивать данные разных пользователей
 * нельзя: домен не фильтрует по `userId` повторно.
 *
 * Индекс строится на этом объекте и живёт только в рамках запроса.
 * Процессного кэша по `userId` нет — иначе данные утекли бы между пользователями.
 *
 * @see docs/architecture.md ADR-007
 */
export type Ledger = {
  readonly cards: readonly Card[];
  readonly entries: readonly BalanceEntry[];
};

const LEDGER_INDEX: unique symbol = Symbol('izicrm.ledgerIndex');

type LedgerIndex = {
  readonly byCard: ReadonlyMap<CardId, readonly BalanceEntry[]>;
  readonly sorted: readonly BalanceEntry[];
  readonly dates: readonly BusinessDate[];
};

export type IndexedLedger = Ledger & {
  readonly [LEDGER_INDEX]: LedgerIndex;
};

function isIndexedLedger(ledger: Ledger): ledger is IndexedLedger {
  return LEDGER_INDEX in ledger;
}

/**
 * Готовит индекс леджера: записи по карте и общий порядок по дате.
 * Повторный вызов на уже проиндексированном снимке — no-op (тот же объект).
 * Вызывать один раз на запрос и передавать дальше.
 */
export function indexLedger(ledger: Ledger): IndexedLedger {
  if (isIndexedLedger(ledger)) {
    return ledger;
  }

  const sorted = ledger.entries.slice().sort((left, right) => {
    const byDate = compareDates(left.effectiveDate, right.effectiveDate);
    if (byDate !== 0) {
      return byDate;
    }
    return left.cardId - right.cardId;
  });

  const byCard = new Map<CardId, BalanceEntry[]>();
  const dates: BusinessDate[] = [];
  for (const entry of sorted) {
    const bucket = byCard.get(entry.cardId);
    if (bucket === undefined) {
      byCard.set(entry.cardId, [entry]);
    } else {
      bucket.push(entry);
    }
    const lastDate = dates[dates.length - 1];
    if (lastDate !== entry.effectiveDate) {
      dates.push(entry.effectiveDate);
    }
  }

  return {
    cards: ledger.cards,
    entries: ledger.entries,
    [LEDGER_INDEX]: { byCard, sorted, dates },
  };
}

function locfInCard(entries: readonly BalanceEntry[], date: BusinessDate): Money | undefined {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const entry = entries[mid] as BalanceEntry;
    if (compareDates(entry.effectiveDate, date) <= 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  if (lo === 0) {
    return undefined;
  }
  const found = entries[lo - 1] as BalanceEntry;
  return found.amount;
}

function lowerBoundByDate(sorted: readonly BalanceEntry[], date: BusinessDate): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const entry = sorted[mid] as BalanceEntry;
    if (compareDates(entry.effectiveDate, date) < 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function upperBoundByDate(sorted: readonly BalanceEntry[], date: BusinessDate): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const entry = sorted[mid] as BalanceEntry;
    if (compareDates(entry.effectiveDate, date) <= 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function lastDateBefore(dates: readonly BusinessDate[], date: BusinessDate): BusinessDate | undefined {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const at = dates[mid] as BusinessDate;
    if (compareDates(at, date) < 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  if (lo === 0) {
    return undefined;
  }
  return dates[lo - 1] as BusinessDate;
}

/**
 * LOCF-баланс карты на дату D: сумма последней актуальной записи с
 * `effective_date ≤ D`. `undefined`, если записей нет.
 *
 * `B(c, D) = amount(E(c, d*)),  d* = max{ d : d ≤ D, E(c, d) существует }`
 *
 * @see docs/financial-model.md §3.2
 */
export function balanceAsOf(ledger: Ledger, cardId: CardId, date: BusinessDate): Money | undefined {
  const indexed = indexLedger(ledger);
  const entries = indexed[LEDGER_INDEX].byCard.get(cardId);
  if (entries === undefined) {
    return undefined;
  }
  return locfInCard(entries, date);
}

/**
 * `prev(u, D) = max{ d : d < D, ∃ запись с effective_date = d }`
 *
 * @see docs/financial-model.md §5.2
 */
export function previousUpdateDate(ledger: Ledger, date: BusinessDate): BusinessDate | undefined {
  return lastDateBefore(indexLedger(ledger)[LEDGER_INDEX].dates, date);
}

export function firstEntryDate(ledger: Ledger): BusinessDate | undefined {
  return indexLedger(ledger)[LEDGER_INDEX].dates[0];
}

export function lastEntryDate(ledger: Ledger): BusinessDate | undefined {
  const dates = indexLedger(ledger)[LEDGER_INDEX].dates;
  return dates[dates.length - 1];
}

/**
 * Актуальные записи с `from ≤ effective_date ≤ to`, в порядке даты.
 */
export function entriesInClosedRange(
  ledger: Ledger,
  from: BusinessDate,
  to: BusinessDate,
): readonly BalanceEntry[] {
  const sorted = indexLedger(ledger)[LEDGER_INDEX].sorted;
  if (sorted.length === 0) {
    return sorted;
  }
  const start = lowerBoundByDate(sorted, from);
  const end = upperBoundByDate(sorted, to);
  if (start >= end) {
    return [];
  }
  return sorted.slice(start, end);
}
