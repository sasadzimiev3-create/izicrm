import { describe, expect, it } from 'vitest';

import { buildStatsFromLedger, shareOf } from '../../../src/application/services/stats.service.js';
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
    expect(stats.capitalSeries[0]?.capital.toFixed()).toBe('10000.00');
    expect(stats.capitalSeries.at(-1)?.capital.toFixed()).toBe('11200.00');
    expect(stats.materials).toHaveLength(1);
    expect(stats.materials[0]?.name).toBe('Сбер');
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
