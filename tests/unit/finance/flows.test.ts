import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../src/domain/errors.js';
import {
  capitalInOf,
  deriveWithdrawal,
  netDeposits,
  netFlow,
  signedFlows,
  spendDelta,
  topUpDelta,
  totalArchiveWithdrawals,
} from '../../../src/domain/finance/flows.js';
import { d, expectMoney, makeCard, makeEntry, makeLedger, rub } from './fixtures.js';

describe('capitalInOf', () => {
  it('0 при отсутствии записи, иначе capital_in', () => {
    expectMoney(capitalInOf(undefined), '0');
    expectMoney(capitalInOf(makeEntry(1, '2024-08-20', '100', '40')), '40');
  });
});

describe('deriveWithdrawal', () => {
  const prev = makeEntry(1, '2024-08-19', '20000');

  it('WITHDRAWN → остаток на дату архива; TRANSFERRED и LOST → 0', () => {
    const withdrawn = makeCard({
      id: 1,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-20',
      archiveReason: 'WITHDRAWN',
    });
    const transferred = makeCard({
      id: 1,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-20',
      archiveReason: 'TRANSFERRED',
    });
    const lost = makeCard({
      id: 1,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-20',
      archiveReason: 'LOST',
    });
    const live = makeCard({ id: 1, createdOn: '2024-08-01' });
    const ledger = makeLedger([withdrawn], [prev]);

    expectMoney(deriveWithdrawal(ledger, withdrawn), '20000');
    expectMoney(deriveWithdrawal(makeLedger([transferred], [prev]), transferred), '0');
    expectMoney(deriveWithdrawal(makeLedger([lost], [prev]), lost), '0');
    expectMoney(deriveWithdrawal(makeLedger([live], [prev]), live), '0');
  });

  it('WITHDRAWN без записей → 0', () => {
    const card = makeCard({
      id: 1,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-20',
      archiveReason: 'WITHDRAWN',
    });
    expectMoney(deriveWithdrawal(makeLedger([card], []), card), '0');
  });
});

describe('netFlow / netDeposits', () => {
  it('депозиты минус траты минус выводы WITHDRAWN; даты вне интервала не входят', () => {
    const live = makeCard({ id: 1, createdOn: '2024-08-01' });
    const gone = makeCard({
      id: 2,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-20',
      archiveReason: 'WITHDRAWN',
    });
    const ledger = makeLedger(
      [live, gone],
      [
        makeEntry(1, '2024-08-10', '100', '100'),
        makeEntry(1, '2024-08-20', '80', '30', '10'),
        makeEntry(2, '2024-08-19', '25'),
        makeEntry(1, '2024-08-21', '90', '5'),
      ],
    );

    expectMoney(netDeposits(ledger, d('2024-08-20'), d('2024-08-20')), '30');
    expectMoney(netFlow(ledger, d('2024-08-20'), d('2024-08-20')), '-5');
    expectMoney(totalArchiveWithdrawals(ledger, d('2024-08-20'), d('2024-08-20')), '25');
    expectMoney(netFlow(ledger, d('2024-08-01'), d('2024-08-19')), '100');
  });

  it('signedFlows отбрасывает нули и включает знаковые ненулевые', () => {
    const card = makeCard({
      id: 1,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-20',
      archiveReason: 'WITHDRAWN',
    });
    const lost = makeCard({
      id: 2,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-20',
      archiveReason: 'LOST',
    });
    const ledger = makeLedger(
      [card, lost],
      [
        makeEntry(1, '2024-08-19', '40'),
        makeEntry(2, '2024-08-19', '7'),
        makeEntry(1, '2024-08-18', '10', '10'),
        makeEntry(1, '2024-08-17', '8', '0', '3'),
      ],
    );
    const flows = signedFlows(ledger, d('2024-08-17'), d('2024-08-20'));
    expect(flows.map((item) => ({ date: item.date, amount: item.amount.toFixed() }))).toEqual([
      { date: '2024-08-17', amount: '-3.00' },
      { date: '2024-08-18', amount: '10.00' },
      { date: '2024-08-20', amount: '-40.00' },
    ]);
  });
});

describe('topUpDelta / spendDelta', () => {
  it('FT-28: Y ≤ текущего отклоняется', () => {
    expect(topUpDelta(rub('80'), rub('90')).toFixed()).toBe('10.00');
    expect(() => topUpDelta(rub('80'), rub('80'))).toThrow(ValidationError);
    expect(() => topUpDelta(rub('80'), rub('70'))).toThrowError(
      'Новый баланс должен быть больше текущего',
    );
  });

  it('трата: Y ≥ текущего отклоняется', () => {
    expect(spendDelta(rub('80'), rub('70')).toFixed()).toBe('10.00');
    expect(() => spendDelta(rub('80'), rub('80'))).toThrow(ValidationError);
    expect(() => spendDelta(rub('80'), rub('90'))).toThrowError(
      'Новый баланс должен быть меньше текущего',
    );
  });
});
