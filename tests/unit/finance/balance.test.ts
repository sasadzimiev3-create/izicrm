import { describe, expect, it } from 'vitest';

import { cardId } from '../../../src/domain/cards/card.js';
import {
  balanceAsOf,
  entriesInClosedRange,
  firstEntryDate,
  indexLedger,
  lastEntryDate,
  previousUpdateDate,
} from '../../../src/domain/finance/balance.js';
import { d, expectMoney, makeCard, makeEntry, makeLedger } from './fixtures.js';

describe('balanceAsOf (LOCF)', () => {
  const card = makeCard({ id: 1, createdOn: '2024-08-01' });
  const ledger = makeLedger(
    [card],
    [makeEntry(1, '2024-08-10', '10000'), makeEntry(1, '2024-08-14', '10300')],
  );

  it('берёт последнюю запись с датой ≤ D', () => {
    expectMoney(balanceAsOf(ledger, cardId(1), d('2024-08-10'))!, '10000');
    expectMoney(balanceAsOf(ledger, cardId(1), d('2024-08-12'))!, '10000');
    expectMoney(balanceAsOf(ledger, cardId(1), d('2024-08-14'))!, '10300');
    expectMoney(balanceAsOf(ledger, cardId(1), d('2024-08-20'))!, '10300');
  });

  it('undefined, если записей нет или все позже D', () => {
    expect(balanceAsOf(ledger, cardId(1), d('2024-08-01'))).toBeUndefined();
    expect(balanceAsOf(ledger, cardId(2), d('2024-08-20'))).toBeUndefined();
    expect(balanceAsOf(makeLedger([card], []), cardId(1), d('2024-08-20'))).toBeUndefined();
  });
});

describe('даты обновлений', () => {
  const ledger = makeLedger(
    [makeCard({ id: 1, createdOn: '2024-08-01' }), makeCard({ id: 2, createdOn: '2024-08-01' })],
    [
      makeEntry(1, '2024-08-10', '100'),
      makeEntry(2, '2024-08-12', '200'),
      makeEntry(1, '2024-08-14', '110'),
    ],
  );

  it('previousUpdateDate — max d < D среди любых карт', () => {
    expect(previousUpdateDate(ledger, d('2024-08-14'))).toBe('2024-08-12');
    expect(previousUpdateDate(ledger, d('2024-08-12'))).toBe('2024-08-10');
    expect(previousUpdateDate(ledger, d('2024-08-10'))).toBeUndefined();
  });

  it('first / last', () => {
    expect(firstEntryDate(ledger)).toBe('2024-08-10');
    expect(lastEntryDate(ledger)).toBe('2024-08-14');
    expect(firstEntryDate(makeLedger([], []))).toBeUndefined();
    expect(lastEntryDate(makeLedger([], []))).toBeUndefined();
  });
});

describe('индекс леджера (много записей, один пользователь на запрос)', () => {
  it('indexLedger идемпотентен и не смешивает два снимка', () => {
    const a = makeLedger(
      [makeCard({ id: 1, createdOn: '2024-01-01' })],
      [makeEntry(1, '2024-08-01', '10')],
    );
    const b = makeLedger(
      [makeCard({ id: 1, createdOn: '2024-01-01' })],
      [makeEntry(1, '2024-08-01', '99')],
    );
    const indexedA = indexLedger(a);
    expect(indexLedger(indexedA)).toBe(indexedA);
    expectMoney(balanceAsOf(indexedA, cardId(1), d('2024-08-01'))!, '10');
    expectMoney(balanceAsOf(b, cardId(1), d('2024-08-01'))!, '99');
  });

  it('LOCF по длинной истории карты — двоичный поиск, не полный скан', () => {
    const card = makeCard({ id: 1, createdOn: '2024-01-01' });
    const entries = [];
    for (let day = 1; day <= 28; day += 1) {
      entries.push(makeEntry(1, `2024-06-${String(day).padStart(2, '0')}`, String(day * 10)));
    }
    const ledger = makeLedger([card], entries.reverse());
    expectMoney(balanceAsOf(ledger, cardId(1), d('2024-06-01'))!, '10');
    expectMoney(balanceAsOf(ledger, cardId(1), d('2024-06-15'))!, '150');
    expectMoney(balanceAsOf(ledger, cardId(1), d('2024-06-28'))!, '280');
    expect(balanceAsOf(ledger, cardId(1), d('2024-05-31'))).toBeUndefined();
  });

  it('entriesInClosedRange отсекает даты вне интервала', () => {
    const ledger = makeLedger(
      [makeCard({ id: 1, createdOn: '2024-08-01' }), makeCard({ id: 2, createdOn: '2024-08-01' })],
      [
        makeEntry(1, '2024-08-10', '1'),
        makeEntry(2, '2024-08-10', '2'),
        makeEntry(1, '2024-08-14', '3'),
        makeEntry(1, '2024-08-20', '4'),
      ],
    );
    expect(entriesInClosedRange(ledger, d('2024-08-10'), d('2024-08-14')).map((item) => item.amount.toFixed())).toEqual([
      '1.00',
      '2.00',
      '3.00',
    ]);
    expect(entriesInClosedRange(ledger, d('2024-08-01'), d('2024-08-05'))).toEqual([]);
    expect(entriesInClosedRange(ledger, d('2024-08-21'), d('2024-08-25'))).toEqual([]);
    expect(entriesInClosedRange(ledger, d('2024-08-20'), d('2024-08-10'))).toEqual([]);
    expect(entriesInClosedRange(makeLedger([], []), d('2024-08-01'), d('2024-08-31'))).toEqual([]);
  });
});
