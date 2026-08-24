import { describe, expect, it } from 'vitest';

import {
  capitalAsOf,
  frozenCapitalAsOf,
  workingCapitalAsOf,
} from '../../../src/domain/finance/capital.js';
import { d, expectMoney, makeCard, makeEntry, makeLedger } from './fixtures.js';

describe('капитал', () => {
  it('FT-11 / T-6: сумма карт = капитал, в работе + заморожено = всего', () => {
    const working = makeCard({ id: 1, createdOn: '2024-08-01', name: 'Сбер' });
    const frozen = makeCard({ id: 2, createdOn: '2024-08-01', name: 'Нал', frozenOn: '2024-08-20' });
    const archived = makeCard({
      id: 3,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-19',
      archiveReason: 'WITHDRAWN',
    });
    const future = makeCard({ id: 4, createdOn: '2024-08-21' });
    const ledger = makeLedger(
      [working, frozen, archived, future],
      [
        makeEntry(1, '2024-08-18', '80000'),
        makeEntry(2, '2024-08-18', '20000'),
        makeEntry(3, '2024-08-18', '5000'),
        makeEntry(4, '2024-08-21', '1', '1'),
      ],
    );
    const today = d('2024-08-20');

    expectMoney(workingCapitalAsOf(ledger, today), '80000');
    expectMoney(frozenCapitalAsOf(ledger, today), '20000');
    expectMoney(capitalAsOf(ledger, today), '100000');
    expect(
      workingCapitalAsOf(ledger, today)
        .plus(frozenCapitalAsOf(ledger, today))
        .eq(capitalAsOf(ledger, today)),
    ).toBe(true);
  });

  it('пустой набор и карта без записей → 0', () => {
    const empty = makeLedger([], []);
    expectMoney(capitalAsOf(empty, d('2024-08-20')), '0');
    expectMoney(workingCapitalAsOf(empty, d('2024-08-20')), '0');
    expectMoney(frozenCapitalAsOf(empty, d('2024-08-20')), '0');

    const ghost = makeCard({ id: 1, createdOn: '2024-08-01' });
    const frozenGhost = makeCard({ id: 2, createdOn: '2024-08-01', frozenOn: '2024-08-20' });
    const ledger = makeLedger([ghost, frozenGhost], []);
    expectMoney(capitalAsOf(ledger, d('2024-08-20')), '0');
    expectMoney(workingCapitalAsOf(ledger, d('2024-08-20')), '0');
    expectMoney(frozenCapitalAsOf(ledger, d('2024-08-20')), '0');
  });

  it('FT-20: все архивированы — капитал 0', () => {
    const card = makeCard({
      id: 1,
      createdOn: '2024-08-01',
      archivedOn: '2024-08-19',
      archiveReason: 'WITHDRAWN',
    });
    const ledger = makeLedger([card], [makeEntry(1, '2024-08-18', '5000')]);
    expectMoney(capitalAsOf(ledger, d('2024-08-20')), '0');
  });
});
