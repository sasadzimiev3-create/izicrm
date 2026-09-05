import type { ActivitySnapshot } from '../../../application/dto/activity-stats.js';

export function renderActivityReport(snapshot: ActivitySnapshot): string {
  return [
    'Активность',
    '',
    'Сегодня',
    `Впервые /start: ${snapshot.newStartToday}`,
    `После старта: ${snapshot.usedAfterStartToday}`,
    `Ряд дней (сегодня и вчера): ${snapshot.streakToday}`,
    `Кабинет: ${snapshot.webToday} чел.`,
    '',
    '7 дней',
    `Впервые /start: ${snapshot.newStartWeek}`,
    `После старта: ${snapshot.usedAfterStartWeek}`,
    `Ряд дней (2+ подряд): ${snapshot.streakWeek}`,
    `Кабинет: ${snapshot.webWeek} чел.`,
    '',
    `Всего /start: ${snapshot.registeredAll}`,
    `Заблокировали бота: ${snapshot.blockedAll}`,
    `С материалом: ${snapshot.withMaterialAll}`,
  ].join('\n');
}
