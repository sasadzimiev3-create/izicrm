import { percentChange, type PercentResult } from '../money/percent.js';
import { Money } from '../money/money.js';
import {
  firstEntryDate,
  indexLedger,
  lastEntryDate,
  previousUpdateDate,
  type Ledger,
} from './balance.js';
import { capitalAsOf } from './capital.js';
import { netDeposits, netFlow, totalArchiveWithdrawals } from './flows.js';
import {
  addDays,
  compareDates,
  daysBetween,
  minDate,
  monthEnd,
  monthStart,
  type BusinessDate,
} from './period.js';

/**
 * Разложение `periodPnl`: прибыль, база, поток. Арифметика живёт только здесь.
 */
export type PeriodPnl = {
  amount: Money;
  percent: PercentResult;
  openingCapital: Money;
  closingCapital: Money;
  netFlow: Money;
};

export type DailyPnl =
  | (PeriodPnl & { defined: true; prevDate: BusinessDate; periodDays: number })
  | { defined: false; reason: 'NO_PREVIOUS_DATA' };

export type AllTimePnl =
  | (PeriodPnl & { defined: true; totalDeposits: Money; totalWithdrawals: Money })
  | { defined: false; reason: 'NO_PREVIOUS_DATA' };

/**
 * Единственная функция расчёта прибыли (FR-5.9, NFR-8):
 * `PnL(u, A, B) = Cap(u, B) − Cap(u, A − 1 день) − NetFlow(u, [A, B])`
 *
 * База — закрытие дня перед периодом. Потоки — за `[A, B]` включительно.
 *
 * @see docs/financial-model.md §5
 */
export function periodPnl(ledger: Ledger, from: BusinessDate, to: BusinessDate): PeriodPnl {
  const indexed = indexLedger(ledger);
  const openingCapital = capitalAsOf(indexed, addDays(from, -1));
  const closingCapital = capitalAsOf(indexed, to);
  const flow = netFlow(indexed, from, to);
  const amount = closingCapital.minus(openingCapital).minus(flow);
  return {
    amount,
    percent: percentChange(amount, openingCapital),
    openingCapital,
    closingCapital,
    netFlow: flow,
  };
}

/**
 * `Return(u, A, B) = PnL / Cap(A − 1) × 100` при базе > 0, иначе «—».
 *
 * @see docs/financial-model.md §5.1
 */
export function periodReturn(ledger: Ledger, from: BusinessDate, to: BusinessDate): PercentResult {
  return periodPnl(ledger, from, to).percent;
}

/**
 * `DailyPnL(u, D) = PnL(u, prev + 1, D)`. Нет `prev` — P&L не определён (FR-5.6).
 * `periodDays = D − prev` в календарных днях (C-14).
 *
 * @see docs/financial-model.md §5.2
 */
export function dailyPnl(ledger: Ledger, date: BusinessDate): DailyPnl {
  const indexed = indexLedger(ledger);
  const prevDate = previousUpdateDate(indexed, date);
  if (prevDate === undefined) {
    return { defined: false, reason: 'NO_PREVIOUS_DATA' };
  }
  const from = addDays(prevDate, 1);
  const pnl = periodPnl(indexed, from, date);
  return {
    defined: true,
    ...pnl,
    prevDate,
    periodDays: daysBetween(prevDate, date),
  };
}

/**
 * Месячный P&L: `S` — 1-е число, `E = min(конец месяца, последняя запись)`.
 * Если последняя запись раньше месяца, `E` — конец месяца (LOCF, потоков нет).
 * База — закрытие последнего дня предыдущего месяца (C-4).
 *
 * @see docs/financial-model.md §5.3
 */
export function monthlyPnl(ledger: Ledger, year: number, month: number): PeriodPnl {
  const indexed = indexLedger(ledger);
  const start = monthStart(year, month);
  const end = monthEnd(year, month);
  const last = lastEntryDate(indexed);
  const to = last === undefined ? end : clipMonthEnd(start, end, last);
  return periodPnl(indexed, start, to);
}

function clipMonthEnd(start: BusinessDate, end: BusinessDate, last: BusinessDate): BusinessDate {
  if (compareDates(last, start) < 0) {
    return end;
  }
  return minDate(end, last);
}

/**
 * P&L за всё время: `periodPnl` от первой записи до `today`.
 * Доходность — к сумме депозитов, не к `Cap(A−1) = 0` (C-15).
 *
 * `TotalPnL = Cap(today) − TotalDeposits + TotalWithdrawals` — следствие
 * главной формулы при `Cap(first − 1) = 0` и учёте `capital_out` в `NetFlow`.
 *
 * @see docs/financial-model.md §5.4
 */
export function allTimePnl(ledger: Ledger, today: BusinessDate): AllTimePnl {
  const indexed = indexLedger(ledger);
  const first = firstEntryDate(indexed);
  if (first === undefined) {
    return { defined: false, reason: 'NO_PREVIOUS_DATA' };
  }
  const pnl = periodPnl(indexed, first, today);
  const totalDeposits = netDeposits(indexed, first, today);
  const totalWithdrawals = totalArchiveWithdrawals(indexed, first, today);
  return {
    defined: true,
    ...pnl,
    percent: percentChange(pnl.amount, totalDeposits),
    totalDeposits,
    totalWithdrawals,
  };
}
