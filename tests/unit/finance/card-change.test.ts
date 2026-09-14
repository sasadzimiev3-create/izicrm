import { describe, expect, it } from 'vitest';

import { cardAllTimeChange, cardBalanceChange } from '../../../src/domain/finance/card-change.js';
import { allTimePnl } from '../../../src/domain/finance/pnl.js';
import { d, expectMoney, makeCard, makeEntry, makeLedger } from './fixtures.js';

describe('cardBalanceChange', () => {
  it('база — prev пользователя, не последнее обновление карты', () => {
    const sber = makeCard({ id: 1, createdOn: '2024-08-01', name: 'Сбер' });
    const tink = makeCard({ id: 2, createdOn: '2024-08-01', name: 'Тинькофф' });
    const ledger = makeLedger(
      [sber, tink],
      [
        makeEntry(1, '2024-08-10', '10000'),
        makeEntry(2, '2024-08-10', '20000'),
        makeEntry(1, '2024-08-14', '10500'),
      ],
    );
    const today = d('2024-08-14');

    const sberChange = cardBalanceChange(ledger, sber, today);
    expect(sberChange.defined).toBe(true);
    if (sberChange.defined) {
      expectMoney(sberChange.amount, '500');
      expect(sberChange.percent.defined).toBe(true);
    }

    const tinkChange = cardBalanceChange(ledger, tink, today);
    expect(tinkChange.defined).toBe(true);
    if (tinkChange.defined) {
      expectMoney(tinkChange.amount, '0');
      expect(tinkChange.percent.defined).toBe(true);
      if (tinkChange.percent.defined) {
        expect(tinkChange.percent.value.isZero()).toBe(true);
      }
    }
  });

  it('новая карта / нет prev / архивная — не определено', () => {
    const oldCard = makeCard({ id: 1, createdOn: '2024-08-01' });
    const newCard = makeCard({ id: 2, createdOn: '2024-08-14' });
    const archived = makeCard({
      id: 3,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-14',
      archiveReason: 'WITHDRAWN',
    });
    const ledger = makeLedger(
      [oldCard, newCard, archived],
      [
        makeEntry(1, '2024-08-10', '100'),
        makeEntry(1, '2024-08-14', '110'),
        makeEntry(2, '2024-08-14', '50', '50'),
        makeEntry(3, '2024-08-10', '20'),
      ],
    );

    expect(cardBalanceChange(ledger, newCard, d('2024-08-14'))).toEqual({
      defined: false,
      reason: 'NEW_CARD',
    });
    expect(cardBalanceChange(ledger, archived, d('2024-08-14'))).toEqual({
      defined: false,
      reason: 'NOT_IN_SCOPE',
    });
    expect(
      cardBalanceChange(makeLedger([oldCard], [makeEntry(1, '2024-08-14', '10')]), oldCard, d('2024-08-14')),
    ).toEqual({ defined: false, reason: 'NO_PREVIOUS_DATA' });
  });

  it('карта в scope без записей — изменение от нуля', () => {
    const ghost = makeCard({ id: 1, createdOn: '2024-08-01' });
    const other = makeCard({ id: 2, createdOn: '2024-08-01' });
    const ledger = makeLedger(
      [ghost, other],
      [makeEntry(2, '2024-08-10', '1'), makeEntry(2, '2024-08-14', '1')],
    );
    const change = cardBalanceChange(ledger, ghost, d('2024-08-14'));
    expect(change.defined).toBe(true);
    if (change.defined) {
      expectMoney(change.amount, '0');
    }
  });
});

describe('cardAllTimeChange', () => {
  it('одна карта: совпадает с allTimePnl, депозит не прибыль', () => {
    const sber = makeCard({ id: 1, createdOn: '2024-08-01', name: 'Сбер' });
    const ledger = makeLedger(
      [sber],
      [makeEntry(1, '2024-08-01', '10000', '10000'), makeEntry(1, '2024-08-20', '11200')],
    );
    const today = d('2024-08-20');
    const change = cardAllTimeChange(ledger, sber, today);
    const all = allTimePnl(ledger, today);
    expect(change.defined).toBe(true);
    expect(all.defined).toBe(true);
    if (change.defined && all.defined) {
      expectMoney(change.amount, '1200');
      expectMoney(all.amount, '1200');
      expect(change.percent).toEqual(all.percent);
    }
  });

  it('пополнение и трата не входят в изменение, обновление входит', () => {
    const sber = makeCard({ id: 1, createdOn: '2024-08-01', name: 'Сбер' });
    const ledger = makeLedger(
      [sber],
      [
        makeEntry(1, '2024-08-01', '10000', '10000'),
        makeEntry(1, '2024-08-10', '15000', '5000'),
        makeEntry(1, '2024-08-14', '18000'),
        makeEntry(1, '2024-08-20', '16000', '0', '2000'),
      ],
    );
    const change = cardAllTimeChange(ledger, sber, d('2024-08-20'));
    expect(change.defined).toBe(true);
    if (change.defined) {
      expectMoney(change.amount, '3000');
    }
  });

  it('две карты считаются раздельно; архивная — не определено', () => {
    const sber = makeCard({ id: 1, createdOn: '2024-08-01', name: 'Сбер' });
    const tink = makeCard({ id: 2, createdOn: '2024-08-01', name: 'Тинькофф' });
    const gone = makeCard({
      id: 3,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-20',
      archiveReason: 'WITHDRAWN',
    });
    const ledger = makeLedger(
      [sber, tink, gone],
      [
        makeEntry(1, '2024-08-01', '10000', '10000'),
        makeEntry(1, '2024-08-20', '13000'),
        makeEntry(2, '2024-08-01', '20000', '20000'),
        makeEntry(2, '2024-08-20', '19000'),
        makeEntry(3, '2024-08-01', '5000', '5000'),
      ],
    );
    const today = d('2024-08-20');
    const sberChange = cardAllTimeChange(ledger, sber, today);
    const tinkChange = cardAllTimeChange(ledger, tink, today);
    expect(sberChange.defined).toBe(true);
    expect(tinkChange.defined).toBe(true);
    if (sberChange.defined && tinkChange.defined) {
      expectMoney(sberChange.amount, '3000');
      expectMoney(tinkChange.amount, '-1000');
    }
    expect(cardAllTimeChange(ledger, gone, today)).toEqual({
      defined: false,
      reason: 'NOT_IN_SCOPE',
    });
  });

  it('в scope без записей — нет данных', () => {
    const sber = makeCard({ id: 1, createdOn: '2024-08-01', name: 'Сбер' });
    expect(cardAllTimeChange(makeLedger([sber], []), sber, d('2024-08-20'))).toEqual({
      defined: false,
      reason: 'NO_PREVIOUS_DATA',
    });
  });
});
