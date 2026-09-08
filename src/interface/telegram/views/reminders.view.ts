import {
  formatClock,
  selectedWeekdays,
  type ReminderSettings,
} from '../../../application/dto/reminder.js';

export function renderReminders(settings: ReminderSettings, timeZone: string): string {
  const days = selectedWeekdays(settings.days);
  const when = days.length === 0 ? 'дни не выбраны' : days.join(', ');
  const status = settings.enabled ? 'Включены' : 'Выключены';
  return [
    'Напоминания',
    '',
    status,
    `Время: ${formatClock(settings.notifyMinute)} (${timeZone})`,
    when,
    '',
    'В выбранные дни бот напомнит занести данные.',
  ].join('\n');
}
