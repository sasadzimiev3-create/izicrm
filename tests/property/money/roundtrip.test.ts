import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { formatMoney } from '../../../src/domain/money/format.js';
import { Money } from '../../../src/domain/money/money.js';
import { parseAmount } from '../../../src/domain/money/parse.js';

/** Предел ввода parseAmount: ±10^15 рублей = ±10^17 копеек. */
const MAX_KOPECKS = 10n ** 17n;

const moneyArbitrary = fc.bigInt({ min: -MAX_KOPECKS, max: MAX_KOPECKS }).map((kopecks) => {
  const negative = kopecks < 0n;
  const abs = negative ? -kopecks : kopecks;
  const rubles = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  const sign = negative ? '-' : '';
  return Money.from(`${sign}${rubles.toString()}.${frac}`);
});

describe('property: parse(format(x)) = x', () => {
  it('для любого Money в пределах ввода ±10^15', () => {
    fc.assert(
      fc.property(moneyArbitrary, (amount) => {
        const parsed = parseAmount(formatMoney(amount));
        expect(parsed.eq(amount)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
