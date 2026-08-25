import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../src/domain/errors.js';
import { Decimal } from '../../../src/domain/money/money.js';
import { formatPercent } from '../../../src/domain/money/format.js';
import { modifiedDietzReturn } from '../../../src/domain/finance/dietz.js';
import { monthlyPnl } from '../../../src/domain/finance/pnl.js';
import { d, expectMoney, makeCard, makeEntry, makeLedger } from './fixtures.js';

function exampleP2() {
  const main = makeCard({ id: 1, createdOn: '2024-07-31', name: 'Основная' });
  const added = makeCard({ id: 2, createdOn: '2024-08-15', name: 'Новая' });
  return makeLedger(
    [main, added],
    [
      makeEntry(1, '2024-07-31', '100000', '100000'),
      makeEntry(2, '2024-08-15', '30000', '30000'),
      makeEntry(1, '2024-08-20', '105000'),
    ],
  );
}

describe('modifiedDietzReturn', () => {
  it('FT-24 / П-2: 4.29% за календарный август', () => {
    const ledger = exampleP2();
    const monthly = monthlyPnl(ledger, 2024, 8);
    expectMoney(monthly.amount, '5000');

    const result = modifiedDietzReturn(ledger, d('2024-08-01'), d('2024-08-31'));
    expect(result.defined).toBe(true);
    if (result.defined) {
      const mdb = new Decimal('100000').plus(new Decimal(17).div(31).mul(30000));
      const expected = new Decimal('5000').div(mdb).mul(100);
      expect(result.value.eq(expected)).toBe(true);
      expect(formatPercent(result)).toBe('+4.29%');
    }
  });

  it('MDB = 0 → ZERO_BASE; MDB < 0 → NEGATIVE_BASE', () => {
    const empty = makeLedger([], []);
    expect(modifiedDietzReturn(empty, d('2024-08-01'), d('2024-08-31'))).toEqual({
      defined: false,
      reason: 'ZERO_BASE',
    });

    const credit = makeCard({ id: 1, createdOn: '2024-07-01' });
    const ledger = makeLedger([credit], [makeEntry(1, '2024-07-31', '-1000')]);
    expect(modifiedDietzReturn(ledger, d('2024-08-01'), d('2024-08-31'))).toEqual({
      defined: false,
      reason: 'NEGATIVE_BASE',
    });
  });

  it('from > to — ошибка, не деление на T ≤ 0', () => {
    const ledger = exampleP2();
    expect(() => modifiedDietzReturn(ledger, d('2024-08-31'), d('2024-08-01'))).toThrow(
      ValidationError,
    );
  });
});
