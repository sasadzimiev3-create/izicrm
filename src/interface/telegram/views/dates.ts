import type { BusinessDate } from '../../../domain/finance/period.js';

import { pluralDays } from './copy.js';

const MONTHS_NOM = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
] as const;

const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

function monthIndex(date: BusinessDate): number {
  return Number(date.slice(5, 7)) - 1;
}

/** `20 августа` — для заголовка дневного блока (C-14). */
export function formatDayMonth(date: BusinessDate): string {
  const day = Number(date.slice(8, 10));
  const month = MONTHS_GEN[monthIndex(date)];
  return `${String(day)} ${month ?? ''}`;
}

/** `Август` — имя месяца для блока P&L. */
export function formatMonthTitle(date: BusinessDate): string {
  const raw = MONTHS_NOM[monthIndex(date)] ?? '';
  const first = raw.charAt(0);
  return `${first.toUpperCase()}${raw.slice(1)}`;
}

export function formatDaysSuffix(periodDays: number): string {
  if (periodDays <= 1) {
    return '';
  }
  return ` за ${String(periodDays)} ${pluralDays(periodDays)}`;
}
