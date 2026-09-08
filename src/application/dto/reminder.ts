import { ValidationError } from '../../domain/errors.js';

export const MINUTES_IN_DAY = 24 * 60;
export const DEFAULT_NOTIFY_MINUTE = 21 * 60;

export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

export type ReminderSettings = {
  enabled: boolean;
  notifyMinute: number;
  days: number;
};

export function wrapMinute(value: number): number {
  return ((value % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
}

export function formatClock(minute: number): string {
  const wrapped = wrapMinute(minute);
  const hours = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function parseClock(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/u.exec(value.trim());
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new ValidationError('Время в формате ЧЧ:ММ');
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function hasDay(days: number, bit: number): boolean {
  if (bit < 0 || bit > 6) {
    return false;
  }
  return (days & (1 << bit)) !== 0;
}

export function toggleDay(days: number, bit: number): number {
  if (bit < 0 || bit > 6) {
    return days;
  }
  return days ^ (1 << bit);
}

export function selectedWeekdays(days: number): string[] {
  return WEEKDAY_SHORT.filter((_, bit) => hasDay(days, bit));
}
