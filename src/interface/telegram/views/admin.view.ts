import type { ActivitySnapshot } from '../../../application/dto/activity-stats.js';

export function renderActivityReport(snapshot: ActivitySnapshot): string {
  return [
    'Активность',
    '',
    'Сегодня',
    `Использовали: ${snapshot.usedToday} чел.`,
    `Впервые /start: ${snapshot.newStartToday}`,
    `После старта: ${snapshot.usedAfterStartToday}`,
    `Ряд дней (сегодня и вчера): ${snapshot.streakToday}`,
    `Кабинет: ${snapshot.webToday} чел.`,
    '',
    '7 дней',
    `Использовали: ${snapshot.usedWeek} чел.`,
    `Впервые /start: ${snapshot.newStartWeek}`,
    `После старта: ${snapshot.usedAfterStartWeek}`,
    `Ряд дней (2+ подряд): ${snapshot.streakWeek}`,
    `Кабинет: ${snapshot.webWeek} чел.`,
    '',
    'За всё время',
    `Всего /start: ${snapshot.registeredAll}`,
    `Заблокировали бота: ${snapshot.blockedAll}`,
    `С материалом: ${snapshot.withMaterialAll}`,
  ].join('\n');
}
