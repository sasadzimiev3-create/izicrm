import { describe, expect, it } from 'vitest';

import {
  formatClock,
  hasDay,
  parseClock,
  toggleDay,
  wrapMinute,
} from '../../../src/application/dto/reminder.js';
import { ValidationError } from '../../../src/domain/errors.js';

describe('напоминания — время и дни', () => {
  it('формат часов и переход через полночь', () => {
    expect(formatClock(21 * 60)).toBe('21:00');
    expect(formatClock(wrapMinute(15))).toBe('00:15');
    expect(formatClock(wrapMinute(-15))).toBe('23:45');
    expect(parseClock('09:05')).toBe(9 * 60 + 5);
    expect(parseClock('21:00:00')).toBe(21 * 60);
    expect(() => parseClock('25:00')).toThrow(ValidationError);
  });

  it('галочки дней не дублируют бит', () => {
    const once = toggleDay(0, 0);
    expect(hasDay(once, 0)).toBe(true);
    expect(toggleDay(once, 0)).toBe(0);
    expect(toggleDay(0, 7)).toBe(0);
  });
});
