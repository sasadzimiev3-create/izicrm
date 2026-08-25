import { ValidationError } from '../errors.js';

/**
 * Бизнес-дата: календарный день `YYYY-MM-DD` в таймзоне пользователя (C-8).
 * Не момент времени и не UTC-instant.
 */
export type BusinessDate = string & { readonly __brand: 'BusinessDate' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }
  return 31;
}

function formatDate(year: number, month: number, day: number): BusinessDate {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}` as BusinessDate;
}

function dateParts(date: BusinessDate): { year: number; month: number; day: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/**
 * Дни от 1970-01-01 по пролептическому григорианскому календарю.
 * Алгоритм Howard Hinnant, O(1), без `Date`.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  let y = year;
  y -= month <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(serial: number): { year: number; month: number; day: number } {
  const z = serial + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/**
 * Разбирает и проверяет календарную дату. `Date` / `Date.now()` не используются.
 */
export function parseBusinessDate(value: string): BusinessDate {
  if (DATE_RE.test(value) === false) {
    throw new ValidationError('Некорректная дата');
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new ValidationError('Некорректная дата');
  }
  return value as BusinessDate;
}

export function compareDates(left: BusinessDate, right: BusinessDate): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Интервал `[from, to]` включительно. `from > to` — ошибка, не «пустой период»:
 * иначе `periodPnl` и Dietz молча считают чужой P&L / делят на T ≤ 0.
 */
export function assertClosedRange(from: BusinessDate, to: BusinessDate): void {
  if (compareDates(from, to) > 0) {
    throw new ValidationError('Некорректный период');
  }
}

export function minDate(left: BusinessDate, right: BusinessDate): BusinessDate {
  return compareDates(left, right) <= 0 ? left : right;
}

export function maxDate(left: BusinessDate, right: BusinessDate): BusinessDate {
  return compareDates(left, right) >= 0 ? left : right;
}

/**
 * Сдвиг бизнес-даты на целое число календарных дней. O(1), без `Date.now()`.
 */
export function addDays(date: BusinessDate, days: number): BusinessDate {
  if (!Number.isSafeInteger(days)) {
    throw new ValidationError('Некорректная дата');
  }
  const { year, month, day } = dateParts(date);
  const shifted = civilFromDays(daysFromCivil(year, month, day) + days);
  return parseBusinessDate(formatDate(shifted.year, shifted.month, shifted.day));
}

/**
 * Знаковая разница `to − from` в календарных днях. O(1).
 */
export function daysBetween(from: BusinessDate, to: BusinessDate): number {
  const a = dateParts(from);
  const b = dateParts(to);
  return daysFromCivil(b.year, b.month, b.day) - daysFromCivil(a.year, a.month, a.day);
}

export function monthStart(year: number, month: number): BusinessDate {
  return parseBusinessDate(`${String(year).padStart(4, '0')}-${pad2(month)}-01`);
}

export function monthEnd(year: number, month: number): BusinessDate {
  return parseBusinessDate(
    `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(daysInMonth(year, month))}`,
  );
}
