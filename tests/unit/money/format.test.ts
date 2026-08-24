import { describe, expect, it } from 'vitest';

import { formatMoney, formatMoneyDelta, formatPercent } from '../../../src/domain/money/format.js';
import { Money } from '../../../src/domain/money/money.js';
import { percentChange } from '../../../src/domain/money/percent.js';

const NARROW = '\u202F';
const MINUS = '\u2212';
const EM_DASH = '\u2014';

describe('formatMoney', () => {
  it('UI-14 / C-21: узкий пробел U+202F, ₽, копейки при .00 опущены', () => {
    expect(formatMoney(Money.from('1000327'))).toBe(`1${NARROW}000${NARROW}327 ₽`);
    expect(formatMoney(Money.from('116000'))).toBe(`116${NARROW}000 ₽`);
    expect(formatMoney(Money.from('1234.56'))).toBe(`1${NARROW}234,56 ₽`);
    expect(formatMoney(Money.from('0.01'))).toBe('0,01 ₽');
    expect(formatMoney(Money.zero())).toBe('0 ₽');
    expect(formatMoney(Money.from('-450'))).toBe(`${MINUS}450 ₽`);
  });
});

describe('formatMoneyDelta', () => {
  it('UI-14: знак дельты всегда явный', () => {
    expect(formatMoneyDelta(Money.from('1200'))).toBe(`+1${NARROW}200 ₽`);
    expect(formatMoneyDelta(Money.from('-450'))).toBe(`${MINUS}450 ₽`);
    expect(formatMoneyDelta(Money.zero())).toBe('+0 ₽');
  });
});

describe('formatPercent', () => {
  it('FT-26 / C-5: 1 200 / 114 800 → +1.05% (ROUND_HALF_UP, 2 знака)', () => {
    const result = percentChange(Money.from('1200'), Money.from('114800'));
    expect(formatPercent(result)).toBe('+1.05%');
  });

  it('C-2: неопределённый процент — «—», никогда 0%', () => {
    expect(formatPercent({ defined: false, reason: 'ZERO_BASE' })).toBe(EM_DASH);
    expect(formatPercent({ defined: false, reason: 'NEGATIVE_BASE' })).toBe(EM_DASH);
    expect(formatPercent({ defined: false, reason: 'NO_PREVIOUS_DATA' })).toBe(EM_DASH);
    expect(formatPercent({ defined: false, reason: 'ZERO_BASE' })).not.toBe('0%');
    expect(formatPercent({ defined: false, reason: 'ZERO_BASE' })).not.toBe('0.00%');
  });

  it('нулевой и отрицательный определённый процент', () => {
    expect(formatPercent(percentChange(Money.zero(), Money.from('100')))).toBe('0.00%');
    expect(formatPercent(percentChange(Money.from('-500'), Money.from('10000')))).toBe(
      `${MINUS}5.00%`,
    );
  });
});
