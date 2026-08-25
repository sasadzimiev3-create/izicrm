import { describe, expect, it } from 'vitest';

import { businessDateAt, createClock } from '../../src/config/clock.js';

describe('clock — бизнес-дата в таймзоне пользователя (C-8)', () => {
  it('полночь МСК не совпадает с UTC', () => {
    const instant = new Date('2024-08-31T21:30:00.000Z');
    expect(businessDateAt('Europe/Moscow', instant)).toBe('2024-09-01');
    expect(businessDateAt('UTC', instant)).toBe('2024-08-31');
  });

  it('createClock берёт время только из nowFn', () => {
    const clock = createClock(() => new Date('2024-08-20T10:00:00.000+03:00'));
    expect(clock.businessDate('Europe/Moscow')).toBe('2024-08-20');
  });
});
