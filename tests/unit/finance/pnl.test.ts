import { describe, expect, it } from 'vitest';

import { formatPercent } from '../../../src/domain/money/format.js';
import { addDays } from '../../../src/domain/finance/period.js';
import {
  allTimePnl,
  dailyPnl,
  monthlyPnl,
  periodPnl,
  periodReturn,
} from '../../../src/domain/finance/pnl.js';
import { capitalAsOf } from '../../../src/domain/finance/capital.js';
import { netFlow } from '../../../src/domain/finance/flows.js';
import { d, expectMoney, makeCard, makeEntry, makeLedger, rub } from './fixtures.js';

function twoDay(prev: string, today: string, capitalIn = '0', capitalOut = '0') {
  const card = makeCard({ id: 1, createdOn: '2024-08-01' });
  const ledger = makeLedger(
    [card],
    [makeEntry(1, '2024-08-19', prev), makeEntry(1, '2024-08-20', today, capitalIn, capitalOut)],
  );
  return { card, ledger, today: d('2024-08-20') };
}

describe('periodPnl — единственный источник прибыли', () => {
  it('FT-01: 10 000 → 10 500 ⟹ +500 ₽, +5.00%', () => {
    const { ledger, today } = twoDay('10000', '10500');
    const daily = dailyPnl(ledger, today);
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '500');
      expect(formatPercent(daily.percent)).toBe('+5.00%');
      const viaPeriod = periodPnl(ledger, addDays(daily.prevDate, 1), today);
      expect(daily.amount.eq(viaPeriod.amount)).toBe(true);
      expect(periodReturn(ledger, addDays(daily.prevDate, 1), today)).toEqual(viaPeriod.percent);
    }
  });

  it('FT-02: убыток 10 000 → 9 500', () => {
    const { ledger, today } = twoDay('10000', '9500');
    const daily = dailyPnl(ledger, today);
    expect(daily.defined && daily.amount.toFixed() === '-500.00').toBe(true);
    if (daily.defined) {
      expect(formatPercent(daily.percent)).toBe('\u22125.00%');
    }
  });

  it('FT-03: нулевое изменение', () => {
    const { ledger, today } = twoDay('10000', '10000');
    const daily = dailyPnl(ledger, today);
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '0');
      expect(formatPercent(daily.percent)).toBe('0.00%');
    }
  });

  it('FT-04: точность P&L на ёмкости NUMERIC(20,2)', () => {
    const { ledger, today } = twoDay('999999999999999999.99', '999999999999999999.98');
    const daily = dailyPnl(ledger, today);
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '-0.01');
    }
  });

  it('FT-05: дробные копейки в капитале и P&L', () => {
    const { ledger, today } = twoDay('0.01', '1234.56');
    const daily = dailyPnl(ledger, today);
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '1234.55');
      expectMoney(capitalAsOf(ledger, today), '1234.56');
    }
  });

  it('FT-06 / FT-10: нет prev → P&L и процент «—», не 0', () => {
    const card = makeCard({ id: 1, createdOn: '2024-08-20' });
    const ledger = makeLedger([card], [makeEntry(1, '2024-08-20', '10000', '10000')]);
    expect(dailyPnl(ledger, d('2024-08-20'))).toEqual({
      defined: false,
      reason: 'NO_PREVIOUS_DATA',
    });
  });

  it('FT-14: база 0 → процент «—», без деления на ноль', () => {
    const { ledger, today } = twoDay('0', '100');
    const daily = dailyPnl(ledger, today);
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '100');
      expect(daily.percent).toEqual({ defined: false, reason: 'ZERO_BASE' });
      expect(formatPercent(daily.percent)).toBe('\u2014');
    }
  });

  it('FT-15 / FT-22: отрицательная база — процент «—», баланс считается', () => {
    const { ledger, today } = twoDay('-1000', '-500');
    const daily = dailyPnl(ledger, today);
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '500');
      expect(daily.percent).toEqual({ defined: false, reason: 'NEGATIVE_BASE' });
      expectMoney(capitalAsOf(ledger, today), '-500');
    }
  });
});

describe('примеры П-1…П-8', () => {
  it('FT-09 / П-1: перевод между своими картами → 0 ₽ (T-1)', () => {
    const a = makeCard({ id: 1, createdOn: '2024-08-01', name: 'Сбер1' });
    const b = makeCard({ id: 2, createdOn: '2024-08-01', name: 'Сбер2' });
    const ledger = makeLedger(
      [a, b],
      [
        makeEntry(1, '2024-08-19', '10000'),
        makeEntry(2, '2024-08-19', '20000'),
        makeEntry(1, '2024-08-20', '5000'),
        makeEntry(2, '2024-08-20', '25000'),
      ],
    );
    const daily = dailyPnl(ledger, d('2024-08-20'));
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '0');
      expect(formatPercent(daily.percent)).toBe('0.00%');
    }
  });

  it('FT-07 / П-2: карта в середине месяца → +5 000 ₽', () => {
    const main = makeCard({ id: 1, createdOn: '2024-07-31' });
    const added = makeCard({ id: 2, createdOn: '2024-08-15' });
    const ledger = makeLedger(
      [main, added],
      [
        makeEntry(1, '2024-07-31', '100000', '100000'),
        makeEntry(2, '2024-08-15', '30000', '30000'),
        makeEntry(1, '2024-08-20', '105000'),
      ],
    );
    const monthly = monthlyPnl(ledger, 2024, 8);
    expectMoney(monthly.amount, '5000');
    expect(formatPercent(monthly.percent)).toBe('+5.00%');
  });

  it('FT-07b / П-3: пополнение в середине месяца → +5 000, не +35 000', () => {
    const card = makeCard({ id: 1, createdOn: '2024-07-31' });
    const ledger = makeLedger(
      [card],
      [
        makeEntry(1, '2024-07-31', '100000', '100000'),
        makeEntry(1, '2024-08-15', '130000', '30000'),
        makeEntry(1, '2024-08-20', '135000'),
      ],
    );
    expectMoney(monthlyPnl(ledger, 2024, 8).amount, '5000');
  });

  it('FT-07c / П-3б: обновление и пополнение в один день', () => {
    const { ledger, today } = twoDay('80000', '95000', '10000');
    const daily = dailyPnl(ledger, today);
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '5000');
    }
  });

  it('FT-30 / П-3в: трата не создаёт убытка (T-12)', () => {
    const { ledger, today } = twoDay('80000', '70000', '0', '10000');
    const daily = dailyPnl(ledger, today);
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '0');
      expectMoney(capitalAsOf(ledger, today), '70000');
    }
  });

  it('FT-08 / П-4: архив WITHDRAWN → 0 ₽', () => {
    const a = makeCard({ id: 1, createdOn: '2024-08-01' });
    const b = makeCard({
      id: 2,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-20',
      archiveReason: 'WITHDRAWN',
    });
    const ledger = makeLedger(
      [a, b],
      [
        makeEntry(1, '2024-08-19', '10000'),
        makeEntry(2, '2024-08-19', '20000'),
        makeEntry(1, '2024-08-20', '10000'),
      ],
    );
    const daily = dailyPnl(ledger, d('2024-08-20'));
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '0');
      expectMoney(netFlow(ledger, addDays(daily.prevDate, 1), d('2024-08-20')), '-20000');
    }
  });

  it('FT-08b / П-5: архив TRANSFERRED → 0 ₽', () => {
    const a = makeCard({ id: 1, createdOn: '2024-08-01' });
    const b = makeCard({
      id: 2,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-20',
      archiveReason: 'TRANSFERRED',
    });
    const ledger = makeLedger(
      [a, b],
      [
        makeEntry(1, '2024-08-19', '10000'),
        makeEntry(2, '2024-08-19', '20000'),
        makeEntry(1, '2024-08-20', '30000'),
      ],
    );
    const daily = dailyPnl(ledger, d('2024-08-20'));
    expect(daily.defined && daily.amount.isZero()).toBe(true);
    if (daily.defined) {
      expectMoney(netFlow(ledger, addDays(daily.prevDate, 1), d('2024-08-20')), '0');
    }
  });

  it('FT-08d / П-5б: архив LOST → −20 000 ₽, потока нет (T-9)', () => {
    const a = makeCard({ id: 1, createdOn: '2024-08-01' });
    const b = makeCard({
      id: 2,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-20',
      archiveReason: 'LOST',
    });
    const ledger = makeLedger(
      [a, b],
      [
        makeEntry(1, '2024-08-19', '10000'),
        makeEntry(2, '2024-08-19', '20000'),
        makeEntry(1, '2024-08-20', '10000'),
      ],
    );
    const daily = dailyPnl(ledger, d('2024-08-20'));
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '-20000');
      expectMoney(netFlow(ledger, addDays(daily.prevDate, 1), d('2024-08-20')), '0');
    }
  });

  it('FT-08e: PnL(TRANSFERRED) = PnL(WITHDRAWN) = PnL(LOST) + X', () => {
    const transferred = dailyPnl(
      makeLedger(
        [
          makeCard({ id: 1, createdOn: '2024-08-01' }),
          makeCard({
            id: 2,
            createdOn: '2024-08-01',
            archivedOn: '2024-08-20',
            archiveReason: 'TRANSFERRED',
          }),
        ],
        [
          makeEntry(1, '2024-08-19', '10000'),
          makeEntry(2, '2024-08-19', '20000'),
          makeEntry(1, '2024-08-20', '30000'),
        ],
      ),
      d('2024-08-20'),
    );
    const withdrawn = dailyPnl(
      makeLedger(
        [
          makeCard({ id: 1, createdOn: '2024-08-01' }),
          makeCard({
            id: 2,
            createdOn: '2024-08-01',
            archivedOn: '2024-08-20',
            archiveReason: 'WITHDRAWN',
          }),
        ],
        [
          makeEntry(1, '2024-08-19', '10000'),
          makeEntry(2, '2024-08-19', '20000'),
          makeEntry(1, '2024-08-20', '10000'),
        ],
      ),
      d('2024-08-20'),
    );
    const lost = dailyPnl(
      makeLedger(
        [
          makeCard({ id: 1, createdOn: '2024-08-01' }),
          makeCard({
            id: 2,
            createdOn: '2024-08-01',
            archivedOn: '2024-08-20',
            archiveReason: 'LOST',
          }),
        ],
        [
          makeEntry(1, '2024-08-19', '10000'),
          makeEntry(2, '2024-08-19', '20000'),
          makeEntry(1, '2024-08-20', '10000'),
        ],
      ),
      d('2024-08-20'),
    );
    expect(transferred.defined && withdrawn.defined && lost.defined).toBe(true);
    if (transferred.defined && withdrawn.defined && lost.defined) {
      expectMoney(transferred.amount, '0');
      expectMoney(withdrawn.amount, '0');
      expectMoney(lost.amount, '-20000');
      expect(transferred.amount.eq(withdrawn.amount)).toBe(true);
      expect(withdrawn.amount.eq(lost.amount.plus(rub('20000')))).toBe(true);
    }
  });

  it('FT-08f: LOST при нулевом остатке → 0 ₽', () => {
    const a = makeCard({ id: 1, createdOn: '2024-08-01' });
    const b = makeCard({
      id: 2,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-20',
      archiveReason: 'LOST',
    });
    const ledger = makeLedger(
      [a, b],
      [
        makeEntry(1, '2024-08-19', '10000'),
        makeEntry(2, '2024-08-19', '0'),
        makeEntry(1, '2024-08-20', '10000'),
      ],
    );
    const daily = dailyPnl(ledger, d('2024-08-20'));
    expect(daily.defined && daily.amount.isZero()).toBe(true);
  });

  it('FT-16 / П-6: пропущенные дни, periodDays = 4', () => {
    const card = makeCard({ id: 1, createdOn: '2024-08-01' });
    const ledger = makeLedger(
      [card],
      [makeEntry(1, '2024-08-10', '100000'), makeEntry(1, '2024-08-14', '103000')],
    );
    const daily = dailyPnl(ledger, d('2024-08-14'));
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expect(daily.periodDays).toBe(4);
      expectMoney(daily.amount, '3000');
      expect(formatPercent(daily.percent)).toBe('+3.00%');
    }
  });

  it('FT-17 / П-8: исправление в день создания — только актуальная запись', () => {
    const card = makeCard({ id: 1, createdOn: '2024-08-20' });
    const ledger = makeLedger([card], [makeEntry(1, '2024-08-20', '3000', '3000')]);
    const all = allTimePnl(ledger, d('2024-08-20'));
    expect(all.defined).toBe(true);
    if (all.defined) {
      expectMoney(all.amount, '0');
      expectMoney(all.closingCapital, '3000');
      expectMoney(all.totalDeposits, '3000');
    }
  });

  it('FT-18 / П-7: первая карта — P&L 0 ₽, доходность 0.00%', () => {
    const card = makeCard({ id: 1, createdOn: '2024-08-20' });
    const ledger = makeLedger([card], [makeEntry(1, '2024-08-20', '10000', '10000')]);
    const all = allTimePnl(ledger, d('2024-08-20'));
    expect(all.defined).toBe(true);
    if (all.defined) {
      expectMoney(all.amount, '0');
      expect(formatPercent(all.percent)).toBe('0.00%');
    }
  });

  it('FT-29 / П-7б: заморозка не меняет Cap и PnL (T-11)', () => {
    const work = makeCard({ id: 1, createdOn: '2024-08-01' });
    const frozen = makeCard({ id: 2, createdOn: '2024-08-01', frozenOn: '2024-08-20' });
    const ledger = makeLedger(
      [work, frozen],
      [
        makeEntry(1, '2024-08-19', '80000'),
        makeEntry(2, '2024-08-19', '20000'),
        makeEntry(1, '2024-08-20', '80000'),
        makeEntry(2, '2024-08-20', '20000'),
      ],
    );
    const today = d('2024-08-20');
    expectMoney(capitalAsOf(ledger, today), '100000');
    const daily = dailyPnl(ledger, today);
    expect(daily.defined && daily.amount.isZero()).toBe(true);
  });
});

describe('прочие сценарии матрицы', () => {
  it('FT-08c: архивная карта входит в капитал прошлого периода', () => {
    const card = makeCard({
      id: 1,
      createdOn: '2024-07-01',
      archivedOn: '2024-08-15',
      archiveReason: 'WITHDRAWN',
    });
    const other = makeCard({ id: 2, createdOn: '2024-07-01' });
    const ledger = makeLedger(
      [card, other],
      [
        makeEntry(1, '2024-07-31', '40000'),
        makeEntry(2, '2024-07-31', '60000'),
        makeEntry(2, '2024-08-20', '60000'),
      ],
    );
    expectMoney(capitalAsOf(ledger, d('2024-07-31')), '100000');
    expectMoney(capitalAsOf(ledger, d('2024-08-15')), '60000');
    expectMoney(monthlyPnl(ledger, 2024, 7).openingCapital, '0');
  });

  it('FT-12: обновление одной карты, остальные по LOCF', () => {
    const a = makeCard({ id: 1, createdOn: '2024-08-01' });
    const b = makeCard({ id: 2, createdOn: '2024-08-01' });
    const ledger = makeLedger(
      [a, b],
      [
        makeEntry(1, '2024-08-19', '10000'),
        makeEntry(2, '2024-08-19', '20000'),
        makeEntry(1, '2024-08-20', '12000'),
      ],
    );
    const daily = dailyPnl(ledger, d('2024-08-20'));
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '2000');
      expectMoney(capitalAsOf(ledger, d('2024-08-20')), '32000');
    }
  });

  it('FT-13: обновление всех карт — P&L = дельта капитала', () => {
    const a = makeCard({ id: 1, createdOn: '2024-08-01' });
    const b = makeCard({ id: 2, createdOn: '2024-08-01' });
    const ledger = makeLedger(
      [a, b],
      [
        makeEntry(1, '2024-08-19', '10000'),
        makeEntry(2, '2024-08-19', '20000'),
        makeEntry(1, '2024-08-20', '11000'),
        makeEntry(2, '2024-08-20', '22000'),
      ],
    );
    const daily = dailyPnl(ledger, d('2024-08-20'));
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '3000');
    }
  });

  it('FT-19: создание и архивирование в один день → вклад 0', () => {
    const live = makeCard({ id: 1, createdOn: '2024-08-01' });
    const flash = makeCard({
      id: 2,
      createdOn: '2024-08-20',
      archivedOn: '2024-08-20',
      archiveReason: 'WITHDRAWN',
    });
    const ledger = makeLedger(
      [live, flash],
      [
        makeEntry(1, '2024-08-19', '10000'),
        makeEntry(1, '2024-08-20', '10000'),
        makeEntry(2, '2024-08-20', '5000', '5000'),
      ],
    );
    const daily = dailyPnl(ledger, d('2024-08-20'));
    expect(daily.defined && daily.amount.isZero()).toBe(true);
    expectMoney(capitalAsOf(ledger, d('2024-08-20')), '10000');
  });

  it('FT-20: все архивированы вчера — капитал 0, процент «—»', () => {
    const card = makeCard({
      id: 1,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-19',
      archiveReason: 'WITHDRAWN',
    });
    const ledger = makeLedger(
      [card],
      [makeEntry(1, '2024-08-18', '5000'), makeEntry(1, '2024-08-19', '5000')],
    );
    expectMoney(capitalAsOf(ledger, d('2024-08-20')), '0');
    const daily = dailyPnl(ledger, d('2024-08-20'));
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '0');
      expect(daily.percent).toEqual({ defined: false, reason: 'ZERO_BASE' });
    }
  });

  it('FT-21: ноль карт — капитал 0, всё «—»', () => {
    const ledger = makeLedger([], []);
    expectMoney(capitalAsOf(ledger, d('2024-08-20')), '0');
    expect(dailyPnl(ledger, d('2024-08-20'))).toEqual({
      defined: false,
      reason: 'NO_PREVIOUS_DATA',
    });
    expect(allTimePnl(ledger, d('2024-08-20'))).toEqual({
      defined: false,
      reason: 'NO_PREVIOUS_DATA',
    });
  });

  it('FT-23: 1-е число месяца не попадает в предыдущий месяц', () => {
    const card = makeCard({ id: 1, createdOn: '2024-01-31' });
    const ledger = makeLedger(
      [card],
      [
        makeEntry(1, '2024-01-31', '100', '100'),
        makeEntry(1, '2024-02-01', '130'),
        makeEntry(1, '2024-02-29', '140'),
      ],
    );
    expectMoney(monthlyPnl(ledger, 2024, 2).amount, '40');
    expectMoney(monthlyPnl(ledger, 2024, 1).amount, '0');
  });

  it('FT-26: 1 200 / 114 800 → 1.05% (ROUND_HALF_UP)', () => {
    const { ledger, today } = twoDay('114800', '116000');
    const daily = dailyPnl(ledger, today);
    expect(daily.defined).toBe(true);
    if (daily.defined) {
      expectMoney(daily.amount, '1200');
      expect(formatPercent(daily.percent)).toBe('+1.05%');
    }
  });

  it('FT-27: пополнение не создаёт прибыли', () => {
    const { ledger, today } = twoDay('80000', '90000', '10000');
    const daily = dailyPnl(ledger, today);
    expect(daily.defined && daily.amount.isZero()).toBe(true);
    expectMoney(capitalAsOf(ledger, today), '90000');
  });

  it('T-5: сумма дневных процентов ≠ доходность периода', () => {
    const card = makeCard({ id: 1, createdOn: '2024-08-01' });
    const ledger = makeLedger(
      [card],
      [
        makeEntry(1, '2024-08-10', '100'),
        makeEntry(1, '2024-08-11', '110'),
        makeEntry(1, '2024-08-12', '121'),
      ],
    );
    const first = dailyPnl(ledger, d('2024-08-11'));
    const second = dailyPnl(ledger, d('2024-08-12'));
    const period = periodPnl(ledger, d('2024-08-11'), d('2024-08-12'));
    expect(first.defined && second.defined && period.percent.defined).toBe(true);
    if (
      first.defined &&
      second.defined &&
      first.percent.defined &&
      second.percent.defined &&
      period.percent.defined
    ) {
      const sumDaily = first.percent.value.plus(second.percent.value);
      expect(sumDaily.eq(period.percent.value)).toBe(false);
    }
  });

  it('месячный P&L обрезает E и делегирует periodPnl', () => {
    const card = makeCard({ id: 1, createdOn: '2024-06-01' });
    const onlyJune = makeLedger([card], [makeEntry(1, '2024-06-15', '50', '50')]);
    expectMoney(monthlyPnl(onlyJune, 2024, 8).amount, '0');

    const throughAugust = makeLedger(
      [card],
      [makeEntry(1, '2024-06-15', '50', '50'), makeEntry(1, '2024-09-01', '80')],
    );
    const august = monthlyPnl(throughAugust, 2024, 8);
    const viaPeriod = periodPnl(throughAugust, d('2024-08-01'), d('2024-08-31'));
    expect(august.amount.eq(viaPeriod.amount)).toBe(true);

    expectMoney(monthlyPnl(makeLedger([], []), 2024, 8).amount, '0');
  });

  it('allTimePnl считает через periodPnl, база доходности — депозиты', () => {
    const card = makeCard({ id: 1, createdOn: '2024-08-01' });
    const ledger = makeLedger(
      [card],
      [makeEntry(1, '2024-08-01', '10000', '10000'), makeEntry(1, '2024-08-20', '11000')],
    );
    const all = allTimePnl(ledger, d('2024-08-20'));
    const period = periodPnl(ledger, d('2024-08-01'), d('2024-08-20'));
    expect(all.defined).toBe(true);
    if (all.defined) {
      expect(all.amount.eq(period.amount)).toBe(true);
      expectMoney(all.amount, '1000');
      expect(formatPercent(all.percent)).toBe('+10.00%');
      expectMoney(all.totalDeposits, '10000');
      expectMoney(all.totalWithdrawals, '0');
    }
  });
});
