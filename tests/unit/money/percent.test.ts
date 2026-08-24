import { describe, expect, expectTypeOf, it } from 'vitest';

import { Money } from '../../../src/domain/money/money.js';
import { formatPercent } from '../../../src/domain/money/format.js';
import { percentChange, type PercentResult } from '../../../src/domain/money/percent.js';

describe('percentChange', () => {
  it('считает отношение без округления промежуточного значения', () => {
    const result = percentChange(Money.from('1200'), Money.from('114800'));
    expect(result.defined).toBe(true);
    if (result.defined) {
      expect(result.value.toString()).not.toBe('1.05');
      expect(result.value.toSignificantDigits(8).toString()).toMatch(/^1\.045/);
    }
  });

  it('ZERO_BASE при базе 0, без деления на ноль (C-2)', () => {
    const result = percentChange(Money.from('30'), Money.zero());
    expect(result).toEqual({ defined: false, reason: 'ZERO_BASE' });
  });

  it('NEGATIVE_BASE при отрицательной базе', () => {
    const result = percentChange(Money.from('10'), Money.from('-100'));
    expect(result).toEqual({ defined: false, reason: 'NEGATIVE_BASE' });
  });

  it('PercentResult.defined: false не содержит value — нельзя показать 0%', () => {
    const result: PercentResult = { defined: false, reason: 'NO_PREVIOUS_DATA' };
    expectTypeOf(result).not.toHaveProperty('value');
    if (!result.defined) {
      expect(formatPercent(result)).toBe('\u2014');
    }
  });
});
