import { describe, expect, it } from 'vitest';

import type { ActivitySnapshot } from '../../../src/application/dto/activity-stats.js';
import { renderActivityReport } from '../../../src/interface/telegram/views/admin.view.js';

const SNAPSHOT: ActivitySnapshot = {
  newStartToday: '3',
  newStartWeek: '12',
  usedAfterStartToday: '8',
  usedAfterStartWeek: '20',
  streakToday: '2',
  streakWeek: '5',
  webToday: '1',
  webWeek: '4',
  registeredAll: '40',
  blockedAll: '2',
  withMaterialAll: '15',
};

describe('отчёт /admin', () => {
  it('день и неделя без сумм', () => {
    const text = renderActivityReport(SNAPSHOT);
    expect(text).toContain('Впервые /start: 3');
    expect(text).toContain('После старта: 8');
    expect(text).toContain('Ряд дней (сегодня и вчера): 2');
    expect(text).toContain('Впервые /start: 12');
    expect(text).toContain('После старта: 20');
    expect(text).toContain('Ряд дней (2+ подряд): 5');
    expect(text).toContain('Кабинет: 1 чел.');
    expect(text).toContain('Всего /start: 40');
    expect(text).toContain('С материалом: 15');
    expect(text).not.toMatch(/₽|amount|capital/i);
  });
});
