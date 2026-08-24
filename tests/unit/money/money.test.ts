import { describe, expect, expectTypeOf, it } from 'vitest';

import { ValidationError } from '../../../src/domain/errors.js';
import { Money } from '../../../src/domain/money/money.js';

describe('Money', () => {
  it('нельзя создать из number — ошибка типизации, не рантайма', () => {
    expectTypeOf(Money.from).parameter(0).toEqualTypeOf<string>();
    // @ts-expect-error Money не создаётся из number
    Money.from(100);
  });

  it('FT-04: точность на ёмкости NUMERIC(20,2)', () => {
    const max = Money.from('999999999999999999.99');
    expect(max.toFixed()).toBe('999999999999999999.99');
    expect(max.plus(Money.zero()).toFixed()).toBe('999999999999999999.99');
    expect(max.plus(Money.from('0.01')).toFixed()).toBe('1000000000000000000.00');
  });

  it('FT-05: сложение копеек точно', () => {
    const a = Money.from('0.01');
    const b = Money.from('1234.56');
    expect(a.plus(b).toFixed()).toBe('1234.57');
    expect(b.minus(a).toFixed()).toBe('1234.55');
  });

  it('держивает промежуточный капитал выше предела ввода 10^15 (C-25)', () => {
    const over = Money.from('1000000000000000.01');
    expect(over.toFixed()).toBe('1000000000000000.01');
  });

  it('zero / сравнение / знак', () => {
    const zero = Money.zero();
    const pos = Money.from('10.50');
    const neg = Money.from('-3.25');

    expect(zero.isZero()).toBe(true);
    expect(zero.isNegative()).toBe(false);
    expect(zero.isPositive()).toBe(false);
    expect(Money.from('-0.00').isZero()).toBe(true);
    expect(Money.from('-0.00').isNegative()).toBe(false);

    expect(pos.isPositive()).toBe(true);
    expect(neg.isNegative()).toBe(true);
    expect(neg.abs().toFixed()).toBe('3.25');
    expect(pos.negated().toFixed()).toBe('-10.50');

    expect(pos.eq(Money.from('10.50'))).toBe(true);
    expect(pos.eq(neg)).toBe(false);
    expect(neg.cmp(pos)).toBe(-1);
    expect(pos.cmp(neg)).toBe(1);
    expect(pos.cmp(Money.from('10.5'))).toBe(0);
  });

  it('отклоняет мусор и третий знак после запятой', () => {
    expect(() => Money.from('abc')).toThrow(ValidationError);
    expect(() => Money.from('Infinity')).toThrow(ValidationError);
    expect(() => Money.from('NaN')).toThrow(ValidationError);
    expect(() => Money.from('1.001')).toThrowError('Копейки — не более двух знаков');
  });

  it('сериализация — строка со шкалой 2, не JSON-число', () => {
    const amount = Money.from('12.5');
    expect(amount.toString()).toBe('12.50');
    expect(amount.toJSON()).toBe('12.50');
    expect(JSON.stringify({ amount })).toBe('{"amount":"12.50"}');
    expect(amount.toDecimal().toFixed(2)).toBe('12.50');
  });
});
