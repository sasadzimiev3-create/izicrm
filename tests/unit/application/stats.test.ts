import { describe, expect, it } from 'vitest';

import { buildStatsFromLedger, shareOf } from '../../../src/application/services/stats.service.js';
import { addDays } from '../../../src/domain/finance/period.js';
import { d, makeCard, makeEntry, makeLedger, rub } from '../finance/fixtures.js';

describe('buildStatsFromLedger', () => {
  it('считает капитал и all-time P&L через periodPnl, без прибыли на депозите', () => {
    const card = makeCard({ id: 1, createdOn: '2024-08-01', name: 'Сбер' });
    const ledger = makeLedger(
      [card],
      [makeEntry(1, '2024-08-01', '10000', '10000'), makeEntry(1, '2024-08-20', '11200')],
    );
    const stats = buildStatsFromLedger(ledger, d('2024-08-20'));
    expect(stats.totalCapital.toFixed()).toBe('11200.00');
    expect(stats.allTime.defined).toBe(true);
    if (stats.allTime.defined) {
      expect(stats.allTime.amount.toFixed()).toBe('1200.00');
    }
    expect(stats.dailyPnlSeries).toHaveLength(1);
    expect(stats.dailyPnlSeries[0]?.amount.toFixed()).toBe('1200.00');
    expect(stats.cumulativePnlSeries[0]?.amount.toFixed()).toBe('0.00');
    expect(stats.cumulativePnlSeries.at(-1)?.amount.toFixed()).toBe('1200.00');
    expect(stats.capitalSeries[0]?.capital.toFixed()).toBe('10000.00');
    expect(stats.capitalSeries.at(-1)?.capital.toFixed()).toBe('11200.00');
    expect(stats.materials).toHaveLength(1);
    expect(stats.materials[0]?.name).toBe('Сбер');
    expect(stats.inOut.deposits.toFixed()).toBe('10000.00');
    expect(stats.inOut.withdrawals.toFixed()).toBe('0.00');
    expect(stats.inOut.depositShare).toEqual(shareOf(rub('10000'), rub('10000')));
  });

  it('окно 1W считает periodPnl за неделю, All — allTime, без второго прохода в БД', () => {
    const card = makeCard({ id: 1, createdOn: '2024-08-01', name: 'Сбер' });
    const ledger = makeLedger(
      [card],
      [
        makeEntry(1, '2024-08-01', '10000', '10000'),
        makeEntry(1, '2024-08-10', '11000'),
        makeEntry(1, '2024-08-20', '11200'),
      ],
    );
    const stats = buildStatsFromLedger(ledger, d('2024-08-20'));
    expect(stats.windows.All.amount.toFixed()).toBe('1200.00');
    expect(stats.windows['1W'].from).toBe('2024-08-14');
    expect(stats.windows['1W'].amount.toFixed()).toBe('200.00');
    expect(stats.windows['1W'].closing.toFixed()).toBe('11200.00');
    expect(stats.cumulativePnlSeries.at(-1)?.amount.toFixed()).toBe('1200.00');
    const beforeWeek = addDays(stats.windows['1W'].from, -1);
    const baseline = stats.cumulativePnlSeries.find((point) => point.date === beforeWeek);
    const last = stats.cumulativePnlSeries.at(-1);
    expect(baseline?.amount.toFixed()).toBe('1000.00');
    expect(last?.amount.minus(baseline!.amount).toFixed()).toBe(stats.windows['1W'].amount.toFixed());
  });

  it('архивные карты не попадают в материалы кабинета', () => {
    const live = makeCard({ id: 1, createdOn: '2024-08-01', name: 'Сбер' });
    const frozen = makeCard({ id: 2, createdOn: '2024-08-01', name: 'Нал', frozenOn: '2024-08-10' });
    const archived = makeCard({
      id: 3,
      createdOn: '2024-08-01',
      name: 'Старый',
      archivedOn: '2024-08-15',
    });
    const stillDated = makeCard({
      id: 4,
      createdOn: '2024-08-01',
      name: 'Будущий архив',
      archivedOn: '2024-08-25',
    });
    const ledger = makeLedger(
      [live, frozen, archived, stillDated],
      [
        makeEntry(1, '2024-08-01', '10000', '10000'),
        makeEntry(2, '2024-08-01', '2000', '2000'),
        makeEntry(3, '2024-08-01', '3000', '3000'),
        makeEntry(4, '2024-08-01', '4000', '4000'),
      ],
    );
    const stats = buildStatsFromLedger(ledger, d('2024-08-20'));
    expect(stats.materials.map((item) => item.name)).toEqual(['Сбер', 'Нал']);
  });

  it('ввод/вывод считает доли от оборота; трата и WITHDRAWN входят в вывод', () => {
    const live = makeCard({ id: 1, createdOn: '2024-08-01', name: 'Сбер' });
    const gone = makeCard({
      id: 2,
      createdOn: '2024-08-01',
      name: 'Старый',
      archivedOn: '2024-08-15',
      archiveReason: 'WITHDRAWN',
    });
    const stats = buildStatsFromLedger(
      makeLedger(
        [live, gone],
        [
          makeEntry(1, '2024-08-01', '10000', '10000'),
          makeEntry(1, '2024-08-10', '7000', '0', '3000'),
          makeEntry(2, '2024-08-01', '2000', '2000'),
        ],
      ),
      d('2024-08-20'),
    );
    expect(stats.inOut.deposits.toFixed()).toBe('12000.00');
    expect(stats.inOut.withdrawals.toFixed()).toBe('5000.00');
    expect(stats.inOut.depositShare).toEqual(shareOf(rub('12000'), rub('17000')));
    expect(stats.inOut.withdrawalShare).toEqual(shareOf(rub('5000'), rub('17000')));
  });

  it('ввод/вывод пустой, если записей нет', () => {
    const stats = buildStatsFromLedger(makeLedger([], []), d('2024-08-20'));
    expect(stats.inOut.deposits.toFixed()).toBe('0.00');
    expect(stats.inOut.withdrawals.toFixed()).toBe('0.00');
    expect(stats.inOut.depositShare).toEqual({ defined: false, reason: 'ZERO_BASE' });
    expect(stats.inOut.withdrawalShare).toEqual({ defined: false, reason: 'ZERO_BASE' });
  });

  it('доля в работе не определена при нулевом капитале', () => {
    expect(shareOf(rub('0'), rub('0'))).toEqual({ defined: false, reason: 'ZERO_BASE' });
    const share = shareOf(rub('40'), rub('80'));
    expect(share.defined).toBe(true);
    if (share.defined) {
      expect(share.value.toFixed()).toBe('50');
    }
  });
});
