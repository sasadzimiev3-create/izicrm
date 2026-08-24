import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../src/domain/errors.js';
import {
  addDays,
  compareDates,
  daysBetween,
  maxDate,
  minDate,
  monthEnd,
  monthStart,
  parseBusinessDate,
} from '../../../src/domain/finance/period.js';

describe('parseBusinessDate', () => {
  it('принимает календарные даты YYYY-MM-DD', () => {
    expect(parseBusinessDate('2024-08-20')).toBe('2024-08-20');
    expect(parseBusinessDate('2024-02-29')).toBe('2024-02-29');
    expect(parseBusinessDate('2000-02-29')).toBe('2000-02-29');
  });

  it('отклоняет мусор и несуществующие дни', () => {
    expect(() => parseBusinessDate('20.08.2024')).toThrow(ValidationError);
    expect(() => parseBusinessDate('2024-13-01')).toThrow(ValidationError);
    expect(() => parseBusinessDate('2024-00-01')).toThrow(ValidationError);
    expect(() => parseBusinessDate('2024-01-00')).toThrow(ValidationError);
    expect(() => parseBusinessDate('2024-01-32')).toThrow(ValidationError);
    expect(() => parseBusinessDate('2024-04-31')).toThrow(ValidationError);
    expect(() => parseBusinessDate('2023-02-29')).toThrow(ValidationError);
    expect(() => parseBusinessDate('1900-02-29')).toThrow(ValidationError);
    expect(() => parseBusinessDate('0000-01-01')).toThrow(ValidationError);
    expect(() => parseBusinessDate('2024-02-30')).toThrow(ValidationError);
  });
});

describe('календарная арифметика без Date.now', () => {
  it('addDays пересекает месяцы, годы и високосный февраль', () => {
    expect(addDays(parseBusinessDate('2024-01-31'), 1)).toBe('2024-02-01');
    expect(addDays(parseBusinessDate('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDays(parseBusinessDate('2023-02-28'), 1)).toBe('2023-03-01');
    expect(addDays(parseBusinessDate('2024-12-31'), 1)).toBe('2025-01-01');
    expect(addDays(parseBusinessDate('2024-01-01'), -1)).toBe('2023-12-31');
    expect(addDays(parseBusinessDate('2024-03-01'), -1)).toBe('2024-02-29');
    expect(addDays(parseBusinessDate('2024-08-20'), 0)).toBe('2024-08-20');
    expect(addDays(parseBusinessDate('2024-01-15'), 50)).toBe('2024-03-05');
    expect(addDays(parseBusinessDate('2024-03-15'), -50)).toBe('2024-01-25');
    expect(addDays(parseBusinessDate('2024-01-01'), 365)).toBe('2024-12-31');
    expect(addDays(parseBusinessDate('2024-01-01'), 366)).toBe('2025-01-01');
    expect(addDays(parseBusinessDate('2020-01-01'), 1827)).toBe('2025-01-01');
    expect(addDays(parseBusinessDate('2025-01-01'), -1827)).toBe('2020-01-01');
  });

  it('daysBetween знаковый, inclusive-разность дат', () => {
    expect(daysBetween(parseBusinessDate('2024-08-10'), parseBusinessDate('2024-08-14'))).toBe(4);
    expect(daysBetween(parseBusinessDate('2024-08-14'), parseBusinessDate('2024-08-10'))).toBe(-4);
    expect(daysBetween(parseBusinessDate('2024-08-20'), parseBusinessDate('2024-08-20'))).toBe(0);
  });

  it('compare / min / max', () => {
    const a = parseBusinessDate('2024-08-01');
    const b = parseBusinessDate('2024-08-31');
    expect(compareDates(a, b)).toBe(-1);
    expect(compareDates(b, a)).toBe(1);
    expect(compareDates(a, a)).toBe(0);
    expect(minDate(a, b)).toBe(a);
    expect(minDate(b, a)).toBe(a);
    expect(minDate(a, a)).toBe(a);
    expect(maxDate(a, b)).toBe(b);
    expect(maxDate(b, a)).toBe(b);
    expect(maxDate(a, a)).toBe(a);
  });

  it('FT-23: границы месяца — февраль високосный/нет, 30 и 31 день', () => {
    expect(monthStart(2024, 2)).toBe('2024-02-01');
    expect(monthEnd(2024, 2)).toBe('2024-02-29');
    expect(monthEnd(2023, 2)).toBe('2023-02-28');
    expect(monthEnd(2000, 2)).toBe('2000-02-29');
    expect(monthEnd(1900, 2)).toBe('1900-02-28');
    expect(monthEnd(2024, 1)).toBe('2024-01-31');
    expect(monthEnd(2024, 4)).toBe('2024-04-30');
    expect(monthEnd(2024, 6)).toBe('2024-06-30');
    expect(monthEnd(2024, 9)).toBe('2024-09-30');
    expect(monthEnd(2024, 11)).toBe('2024-11-30');
    expect(monthEnd(2024, 3)).toBe('2024-03-31');
    expect(monthEnd(2024, 12)).toBe('2024-12-31');
    expect(monthStart(2025, 1)).toBe('2025-01-01');
  });
});
