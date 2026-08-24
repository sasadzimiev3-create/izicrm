import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Card } from '../../../src/domain/cards/card.js';
import { Money } from '../../../src/domain/money/money.js';
import {
  balanceAsOf,
  previousUpdateDate,
  type Ledger,
} from '../../../src/domain/finance/balance.js';
import { cardBalanceChange } from '../../../src/domain/finance/card-change.js';
import { isInScope } from '../../../src/domain/finance/card-scope.js';
import {
  capitalAsOf,
  frozenCapitalAsOf,
  workingCapitalAsOf,
} from '../../../src/domain/finance/capital.js';
import { modifiedDietzReturn } from '../../../src/domain/finance/dietz.js';
import { deriveWithdrawal, netFlow, signedFlows } from '../../../src/domain/finance/flows.js';
import { addDays } from '../../../src/domain/finance/period.js';
import {
  allTimePnl,
  dailyPnl,
  monthlyPnl,
  periodPnl,
} from '../../../src/domain/finance/pnl.js';
import {
  d,
  makeCard,
  makeEntry,
  makeLedger,
} from '../../unit/finance/fixtures.js';

function fromKopecks(kopecks: number): Money {
  const negative = kopecks < 0;
  const abs = negative ? -kopecks : kopecks;
  const ruble = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return Money.from(`${negative ? '-' : ''}${String(ruble)}.${frac}`);
}

const kopeckArb = fc.integer({ min: -500_000, max: 500_000 });
const moneyArb = kopeckArb.map(fromKopecks);
const posKopeckArb = fc.integer({ min: 1, max: 500_000 });
const posMoneyArb = posKopeckArb.map(fromKopecks);

function sumMoney(values: readonly Money[]): Money {
  return values.reduce((acc, item) => acc.plus(item), Money.zero());
}

function june(day: number): string {
  return `2024-06-${String(day).padStart(2, '0')}`;
}

function permute<T>(items: readonly T[], keys: readonly number[]): T[] {
  return items
    .map((item, index) => ({ item, key: keys[index] ?? 0 }))
    .sort((left, right) => left.key - right.key)
    .map((pair) => pair.item);
}

function assertFiniteMoney(amount: Money): void {
  const value = amount.toDecimal();
  expect(value.isFinite()).toBe(true);
  expect(value.isNaN()).toBe(false);
}

describe('PT-01…PT-06 теоремы на случайных данных', () => {
  it('PT-01 / T-1: перестановка балансов с той же суммой → P&L = 0', () => {
    fc.assert(
      fc.property(
        fc.array(moneyArb, { minLength: 2, maxLength: 5 }),
        fc.array(moneyArb, { minLength: 1, maxLength: 4 }),
        (before, afterHead) => {
          const n = before.length;
          const head = afterHead.slice(0, n - 1);
          while (head.length < n - 1) {
            head.push(Money.zero());
          }
          const last = sumMoney(before).minus(sumMoney(head));
          const after = [...head, last];
          const cards = before.map((_, i) => makeCard({ id: i + 1, createdOn: '2024-06-01' }));
          const entries = [
            ...before.map((amount, i) => makeEntry(i + 1, june(10), amount.toFixed())),
            ...after.map((amount, i) => makeEntry(i + 1, june(14), amount.toFixed())),
          ];
          const daily = dailyPnl(makeLedger(cards, entries), d(june(14)));
          expect(daily.defined).toBe(true);
          if (daily.defined) {
            expect(daily.amount.isZero()).toBe(true);
          }
        },
      ),
      { numRuns: 80 },
    );
  });

  it('PT-02 / T-2: создание карты с любой суммой не меняет P&L', () => {
    fc.assert(
      fc.property(posMoneyArb, moneyArb, (start, next) => {
        const base = makeCard({ id: 1, createdOn: '2024-06-01' });
        const before = makeLedger(
          [base],
          [makeEntry(1, june(10), start.toFixed()), makeEntry(1, june(14), next.toFixed())],
        );
        const created = makeCard({ id: 2, createdOn: june(14) });
        const after = makeLedger(
          [base, created],
          [
            ...before.entries,
            makeEntry(2, june(14), start.toFixed(), start.toFixed()),
          ],
        );
        const pnlBefore = dailyPnl(before, d(june(14)));
        const pnlAfter = dailyPnl(after, d(june(14)));
        expect(pnlBefore.defined && pnlAfter.defined).toBe(true);
        if (pnlBefore.defined && pnlAfter.defined) {
          expect(pnlBefore.amount.eq(pnlAfter.amount)).toBe(true);
        }
      }),
      { numRuns: 80 },
    );
  });

  it('PT-03 / T-3: WITHDRAWN и TRANSFERRED не меняют P&L; LOST сюда не входит', () => {
    fc.assert(
      fc.property(
        moneyArb,
        moneyArb,
        posMoneyArb,
        fc.constantFrom('WITHDRAWN', 'TRANSFERRED') as fc.Arbitrary<'WITHDRAWN' | 'TRANSFERRED'>,
        (prevMain, nextMain, rest, reason) => {
          const main = makeCard({ id: 1, createdOn: '2024-06-01' });
          const other = makeCard({
            id: 2,
            createdOn: '2024-06-01',
            archivedOn: june(14),
            archiveReason: reason,
          });
          const liveOther = makeCard({ id: 2, createdOn: '2024-06-01' });
          const baseline = makeLedger(
            [main, liveOther],
            [
              makeEntry(1, june(10), prevMain.toFixed()),
              makeEntry(2, june(10), rest.toFixed()),
              makeEntry(1, june(14), nextMain.toFixed()),
              makeEntry(2, june(14), rest.toFixed()),
            ],
          );
          const archivedEntries =
            reason === 'TRANSFERRED'
              ? [
                  makeEntry(1, june(10), prevMain.toFixed()),
                  makeEntry(2, june(10), rest.toFixed()),
                  makeEntry(1, june(14), nextMain.plus(rest).toFixed()),
                ]
              : [
                  makeEntry(1, june(10), prevMain.toFixed()),
                  makeEntry(2, june(10), rest.toFixed()),
                  makeEntry(1, june(14), nextMain.toFixed()),
                ];
          const archived = makeLedger([main, other], archivedEntries);
          const a = dailyPnl(baseline, d(june(14)));
          const b = dailyPnl(archived, d(june(14)));
          expect(a.defined && b.defined).toBe(true);
          if (a.defined && b.defined) {
            expect(a.amount.eq(b.amount)).toBe(true);
          }
        },
      ),
      { numRuns: 80 },
    );
  });

  it('PT-04 / T-4: Σ дневных P&L = P&L периода', () => {
    fc.assert(
      fc.property(fc.array(moneyArb, { minLength: 3, maxLength: 6 }), (amounts) => {
        const dates = amounts.map((_, i) => june(2 + i * 3));
        const card = makeCard({ id: 1, createdOn: '2024-06-01' });
        const first = amounts[0];
        if (first === undefined) {
          return;
        }
        const entries = amounts.map((amount, i) => {
          const date = dates[i];
          if (date === undefined) {
            throw new Error('date');
          }
          return i === 0
            ? makeEntry(1, date, amount.toFixed(), amount.toFixed())
            : makeEntry(1, date, amount.toFixed());
        });
        const ledger = makeLedger([card], entries);
        const last = dates[dates.length - 1];
        const origin = dates[0];
        if (last === undefined || origin === undefined) {
          return;
        }
        let total = Money.zero();
        for (const date of dates.slice(1)) {
          if (date === undefined) {
            continue;
          }
          const daily = dailyPnl(ledger, d(date));
          expect(daily.defined).toBe(true);
          if (daily.defined) {
            total = total.plus(daily.amount);
          }
        }
        const period = periodPnl(ledger, addDays(d(origin), 1), d(last));
        expect(total.eq(period.amount)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it('PT-05 / T-7: дни без обновлений не меняют P&L периода', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, fc.integer({ min: 1, max: 6 }), (prev, next, extra) => {
        const ledger = makeLedger(
          [makeCard({ id: 1, createdOn: '2024-06-01' })],
          [makeEntry(1, june(10), prev.toFixed()), makeEntry(1, june(14), next.toFixed())],
        );
        const from = d(june(11));
        const to = d(june(14));
        const base = periodPnl(ledger, from, to);
        const extended = periodPnl(ledger, from, addDays(to, extra));
        expect(base.amount.eq(extended.amount)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it('PT-06 / T-8: порядок записей не меняет результат', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, fc.array(fc.integer(), { minLength: 4, maxLength: 4 }), (a, b, keys) => {
        const cards = [
          makeCard({ id: 1, createdOn: '2024-06-01' }),
          makeCard({ id: 2, createdOn: '2024-06-01' }),
        ];
        const entries = [
          makeEntry(1, june(10), a.toFixed()),
          makeEntry(2, june(10), b.toFixed()),
          makeEntry(1, june(14), b.toFixed()),
          makeEntry(2, june(14), a.toFixed()),
        ];
        const original = makeLedger(cards, entries);
        const shuffled = makeLedger(permute(cards, keys.slice(0, 2)), permute(entries, keys));
        const left = periodPnl(original, d(june(11)), d(june(14)));
        const right = periodPnl(shuffled, d(june(11)), d(june(14)));
        expect(left.amount.eq(right.amount)).toBe(true);
        expect(left.closingCapital.eq(right.closingCapital)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });
});

describe('PT-07…PT-12', () => {
  it('PT-07: расчёты не бросают и не дают NaN/Infinity', () => {
    const dayArb = fc.integer({ min: 1, max: 28 });
    fc.assert(
      fc.property(dayArb, dayArb, moneyArb, moneyArb, fc.boolean(), (dayA, dayB, a, b, freeze) => {
        const fromDay = Math.min(dayA, dayB);
        const toDay = Math.max(dayA, dayB);
        const card = makeCard({
          id: 1,
          createdOn: june(1),
          frozenOn: freeze ? june(toDay) : null,
        });
        const ledger = makeLedger(
          [card],
          [
            makeEntry(1, june(fromDay), a.toFixed(), fromDay === 1 ? a.toFixed() : '0'),
            makeEntry(1, june(toDay), b.toFixed()),
          ],
        );
        const today = d(june(toDay));
        assertFiniteMoney(capitalAsOf(ledger, today));
        assertFiniteMoney(workingCapitalAsOf(ledger, today));
        assertFiniteMoney(frozenCapitalAsOf(ledger, today));
        assertFiniteMoney(netFlow(ledger, d(june(fromDay)), today));
        const pnl = periodPnl(ledger, d(june(fromDay)), today);
        assertFiniteMoney(pnl.amount);
        if (pnl.percent.defined) {
          expect(pnl.percent.value.isFinite()).toBe(true);
        }
        dailyPnl(ledger, today);
        monthlyPnl(ledger, 2024, 6);
        allTimePnl(ledger, today);
        const dietz = modifiedDietzReturn(ledger, d(june(fromDay)), today);
        if (dietz.defined) {
          expect(dietz.value.isFinite()).toBe(true);
        }
        cardBalanceChange(ledger, card, today);
        signedFlows(ledger, d(june(fromDay)), today);
        deriveWithdrawal(ledger, card);
      }),
      { numRuns: 80 },
    );
  });

  it('PT-08: Cap(D) − Cap(prev) = Σ CardChange + вход − выход', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, posMoneyArb, fc.boolean(), (prevMain, nextMain, extra, archive) => {
        const main = makeCard({ id: 1, createdOn: '2024-06-01' });
        const second: Card = archive
          ? makeCard({
              id: 2,
              createdOn: '2024-06-01',
              archivedOn: june(14),
              archiveReason: 'LOST',
            })
          : makeCard({ id: 2, createdOn: june(14) });
        const entries = archive
          ? [
              makeEntry(1, june(10), prevMain.toFixed()),
              makeEntry(2, june(10), extra.toFixed()),
              makeEntry(1, june(14), nextMain.toFixed()),
            ]
          : [
              makeEntry(1, june(10), prevMain.toFixed()),
              makeEntry(1, june(14), nextMain.toFixed()),
              makeEntry(2, june(14), extra.toFixed(), extra.toFixed()),
            ];
        const ledger = makeLedger([main, second], entries);
        const date = d(june(14));
        const prev = previousUpdateDate(ledger, date);
        expect(prev).toBeDefined();
        if (prev === undefined) {
          return;
        }
        const left = capitalAsOf(ledger, date).minus(capitalAsOf(ledger, prev));
        let right = Money.zero();
        for (const card of ledger.cards) {
          const was = isInScope(card, prev);
          const now = isInScope(card, date);
          if (was && now) {
            const change = cardBalanceChange(ledger, card, date);
            if (change.defined) {
              right = right.plus(change.amount);
            }
          } else if (!was && now) {
            right = right.plus(balanceAsOf(ledger, card.id, date) ?? Money.zero());
          } else if (was && !now) {
            right = right.minus(balanceAsOf(ledger, card.id, prev) ?? Money.zero());
          }
        }
        expect(left.eq(right)).toBe(true);
      }),
      { numRuns: 80 },
    );
  });

  it('PT-09 / T-9: PnL(LOST) = PnL(WITHDRAWN) − X', () => {
    fc.assert(
      fc.property(moneyArb, posMoneyArb, (main, rest) => {
        const keep = makeCard({ id: 1, createdOn: '2024-06-01' });
        function archived(reason: 'WITHDRAWN' | 'LOST'): Ledger {
          return makeLedger(
            [
              keep,
              makeCard({
                id: 2,
                createdOn: '2024-06-01',
                archivedOn: june(14),
                archiveReason: reason,
              }),
            ],
            [
              makeEntry(1, june(10), main.toFixed()),
              makeEntry(2, june(10), rest.toFixed()),
              makeEntry(1, june(14), main.toFixed()),
            ],
          );
        }
        const lost = dailyPnl(archived('LOST'), d(june(14)));
        const withdrawn = dailyPnl(archived('WITHDRAWN'), d(june(14)));
        expect(lost.defined && withdrawn.defined).toBe(true);
        if (lost.defined && withdrawn.defined) {
          expect(lost.amount.eq(withdrawn.amount.minus(rest))).toBe(true);
        }
      }),
      { numRuns: 80 },
    );
  });

  it('PT-10 / T-10: пополнение не меняет P&L; композиция сохраняет прибыль обновления', () => {
    fc.assert(
      fc.property(moneyArb, posMoneyArb, posMoneyArb, (current, top, update) => {
        const card = makeCard({ id: 1, createdOn: '2024-06-01' });
        const y = current.plus(top);
        const topUpOnly = makeLedger(
          [card],
          [
            makeEntry(1, june(10), current.toFixed()),
            makeEntry(1, june(14), y.toFixed(), top.toFixed()),
          ],
        );
        const dailyTop = dailyPnl(topUpOnly, d(june(14)));
        expect(dailyTop.defined && dailyTop.amount.isZero()).toBe(true);

        const y0 = current.plus(update);
        const y1 = y0.plus(top);
        const composed = makeLedger(
          [card],
          [
            makeEntry(1, june(10), current.toFixed()),
            makeEntry(1, june(14), y1.toFixed(), top.toFixed()),
          ],
        );
        const dailyComposed = dailyPnl(composed, d(june(14)));
        expect(dailyComposed.defined).toBe(true);
        if (dailyComposed.defined) {
          expect(dailyComposed.amount.eq(update)).toBe(true);
        }
      }),
      { numRuns: 80 },
    );
  });

  it('PT-11 / T-11: заморозка не меняет Cap и PnL; WorkCap + FrozenCap = Cap', () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, (a, b) => {
        const work = makeCard({ id: 1, createdOn: '2024-06-01' });
        const live = makeCard({ id: 2, createdOn: '2024-06-01' });
        const frozen = makeCard({ id: 2, createdOn: '2024-06-01', frozenOn: june(14) });
        const entries = [
          makeEntry(1, june(10), a.toFixed()),
          makeEntry(2, june(10), b.toFixed()),
          makeEntry(1, june(14), a.toFixed()),
          makeEntry(2, june(14), b.toFixed()),
        ];
        const before = makeLedger([work, live], entries);
        const after = makeLedger([work, frozen], entries);
        const today = d(june(14));
        expect(capitalAsOf(before, today).eq(capitalAsOf(after, today))).toBe(true);
        const pnlBefore = dailyPnl(before, today);
        const pnlAfter = dailyPnl(after, today);
        expect(pnlBefore.defined && pnlAfter.defined).toBe(true);
        if (pnlBefore.defined && pnlAfter.defined) {
          expect(pnlBefore.amount.eq(pnlAfter.amount)).toBe(true);
        }
        expect(
          workingCapitalAsOf(after, today)
            .plus(frozenCapitalAsOf(after, today))
            .eq(capitalAsOf(after, today)),
        ).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it('PT-12 / T-12: трата не меняет P&L; то же Y через обновление — убыток', () => {
    fc.assert(
      fc.property(moneyArb, posMoneyArb, (current, delta) => {
        const y = current.minus(delta);
        const card = makeCard({ id: 1, createdOn: '2024-06-01' });
        const spend = makeLedger(
          [card],
          [
            makeEntry(1, june(10), current.toFixed()),
            makeEntry(1, june(14), y.toFixed(), '0', delta.toFixed()),
          ],
        );
        const update = makeLedger(
          [card],
          [makeEntry(1, june(10), current.toFixed()), makeEntry(1, june(14), y.toFixed())],
        );
        const spendPnl = dailyPnl(spend, d(june(14)));
        const updatePnl = dailyPnl(update, d(june(14)));
        expect(spendPnl.defined && updatePnl.defined).toBe(true);
        if (spendPnl.defined && updatePnl.defined) {
          expect(spendPnl.amount.isZero()).toBe(true);
          expect(updatePnl.amount.eq(delta.negated())).toBe(true);
        }
      }),
      { numRuns: 80 },
    );
  });
});
