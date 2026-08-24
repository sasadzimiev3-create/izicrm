import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../src/domain/errors.js';
import { parseAmount } from '../../../src/domain/money/parse.js';

describe('parseAmount', () => {
  it('принимает канонические форматы из этапа 1', () => {
    expect(parseAmount('10000').toFixed()).toBe('10000.00');
    expect(parseAmount('10 000').toFixed()).toBe('10000.00');
    expect(parseAmount('10.000,50').toFixed()).toBe('10000.50');
    expect(parseAmount('1 234,56 ₽').toFixed()).toBe('1234.56');
  });

  it('принимает пробелы, узкий пробел, подчёркивания и оба десятичных разделителя', () => {
    expect(parseAmount('1\u202F234,56').toFixed()).toBe('1234.56');
    expect(parseAmount('1_234.56').toFixed()).toBe('1234.56');
    expect(parseAmount('10,000.50').toFixed()).toBe('10000.50');
    expect(parseAmount('0,5').toFixed()).toBe('0.50');
    expect(parseAmount('−1 000').toFixed()).toBe('-1000.00');
    expect(parseAmount('-0.01').toFixed()).toBe('-0.01');
    expect(parseAmount('1000000000000000').toFixed()).toBe('1000000000000000.00');
    expect(parseAmount('-1000000000000000.00').toFixed()).toBe('-1000000000000000.00');
  });

  it('FT-25: третий знак после запятой отклонён, не округлён (C-12)', () => {
    expect(() => parseAmount('10000.005')).toThrow(ValidationError);
    expect(() => parseAmount('10000.005')).toThrowError('Копейки — не более двух знаков');
    expect(() => parseAmount('1.234')).toThrowError('Копейки — не более двух знаков');
    expect(() => parseAmount('1,234')).toThrowError('Копейки — не более двух знаков');
  });

  it('FT-04 / C-25: ввод вне ±10^15 — «Слишком большое значение»', () => {
    expect(() => parseAmount('1000000000000000.01')).toThrowError('Слишком большое значение');
    expect(() => parseAmount('-1000000000000000.01')).toThrowError('Слишком большое значение');
    expect(() => parseAmount('1 000 000 000 000 001')).toThrowError('Слишком большое значение');
  });

  it('отвергает мусор, относительный ввод и научную запись (C-10)', () => {
    expect(() => parseAmount('')).toThrowError('Введите сумму');
    expect(() => parseAmount('   ')).toThrowError('Введите сумму');
    expect(() => parseAmount('₽')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('+500')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('1e5')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('1E5')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('10k')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('1+2')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('abc')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('--1')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('−')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('1.')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('.50')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('1.000.000')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('1,000,000')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('1,2.3,4')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('_')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('10.000,')).toThrowError('Некорректная сумма');
    expect(() => parseAmount('1,00 50')).toThrowError('Некорректная сумма');
  });
});
