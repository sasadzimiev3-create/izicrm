import { parseBusinessDate, type BusinessDate } from '../domain/finance/period.js';

/**
 * Единственное место в проекте, где спрашивают текущее время (C-8).
 * Бизнес-дата — календарный день в таймзоне пользователя, не UTC-instant.
 *
 * @see docs/requirements.md C-8
 * @see docs/roadmap.md этап 6
 */
export type Clock = {
  now(): Date;
  businessDate(timeZone: string): BusinessDate;
};

export function businessDateAt(timeZone: string, instant: Date): BusinessDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = lookup['year'];
  const month = lookup['month'];
  const day = lookup['day'];
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('failed to format business date');
  }
  return parseBusinessDate(`${year}-${month}-${day}`);
}

export function createClock(nowFn: () => Date = () => new Date()): Clock {
  return {
    now: nowFn,
    businessDate(timeZone: string): BusinessDate {
      return businessDateAt(timeZone, nowFn());
    },
  };
}
