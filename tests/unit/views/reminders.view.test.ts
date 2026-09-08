import { describe, expect, it } from 'vitest';

import { renderReminders } from '../../../src/interface/telegram/views/reminders.view.js';

describe('экран напоминаний', () => {
  it('без сумм и без «карт»', () => {
    const text = renderReminders(
      { enabled: true, notifyMinute: 21 * 60, days: 1 | 2 | 4 },
      'Europe/Moscow',
    );
    expect(text).toContain('Включены');
    expect(text).toContain('21:00');
    expect(text).toContain('Пн, Вт, Ср');
    expect(text).not.toMatch(/карт|₽|amount/i);
  });
});
