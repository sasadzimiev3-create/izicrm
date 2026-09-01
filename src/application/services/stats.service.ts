import type { CardRow } from '../ports/card-repository.js';
import { balanceAsOf, firstEntryDate, indexLedger, lastEntryDate, type Ledger } from '../../domain/finance/balance.js';
import { cardBalanceChange } from '../../domain/finance/card-change.js';
import { capitalAsOf, frozenCapitalAsOf, workingCapitalAsOf } from '../../domain/finance/capital.js';
import { isFrozen, isInScope, isWorking } from '../../domain/finance/card-scope.js';
import {
  addDays,
  compareDates,
  parseBusinessDate,
  type BusinessDate,
} from '../../domain/finance/period.js';
import { allTimePnl, dailyPnl, monthlyPnl, periodPnl } from '../../domain/finance/pnl.js';
import { netDeposits } from '../../domain/finance/flows.js';
import { percentChange, type PercentResult } from '../../domain/money/percent.js';
import { Money } from '../../domain/money/money.js';
import type { Card, UserId } from '../../domain/cards/card.js';

import type {
  ArchivedMaterial,
  CapitalPoint,
  CumulativePnlPoint,
  DailyPnlPoint,
  FlowEntry,
  MonthlyPnlPoint,
  StatsMaterial,
  StatsSnapshot,
  WindowKey,
  WindowPnl,
} from '../dto/stats.js';

import type { ServiceDeps } from './support.js';

const HISTORY_FROM = parseBusinessDate('1970-01-01');

/** Календарные дни назад от today, сегодня входит в окно. */
const WINDOW_LOOKBACK: Record<Exclude<WindowKey, 'All'>, number> = {
  '1W': 6,
  '1M': 29,
  '3M': 89,
  '1Y': 364,
};

function windowFrom(today: BusinessDate, first: BusinessDate, key: WindowKey): BusinessDate {
  if (key === 'All') {
    return first;
  }
  const start = addDays(today, -WINDOW_LOOKBACK[key]);
  return compareDates(start, first) < 0 ? first : start;
}

/**
 * P&L выбранного окна обзора. `All` — `allTimePnl` (доходность к депозитам, C-15).
 *
 * @see docs/financial-model.md §5
 */
function windowPnl(ledger: Ledger, today: BusinessDate, first: BusinessDate, key: WindowKey): WindowPnl {
  const from = windowFrom(today, first, key);
  if (key === 'All') {
    const all = allTimePnl(ledger, today);
    if (all.defined) {
      return {
        from,
        to: today,
        amount: all.amount,
        percent: all.percent,
        closing: all.closingCapital,
      };
    }
  }
  const pnl = periodPnl(ledger, from, today);
  return {
    from,
    to: today,
    amount: pnl.amount,
    percent: pnl.percent.defined ? pnl.percent : percentChange(pnl.amount, netDeposits(ledger, from, today)),
    closing: pnl.closingCapital,
  };
}

function emptyWindows(today: BusinessDate): Record<WindowKey, WindowPnl> {
  const make = (): WindowPnl => ({
    from: today,
    to: today,
    amount: Money.zero(),
    percent: { defined: false, reason: 'NO_PREVIOUS_DATA' },
    closing: Money.zero(),
  });
  return {
    '1W': make(),
    '1M': make(),
    '3M': make(),
    '1Y': make(),
    All: make(),
  };
}

function monthOf(date: BusinessDate): { year: number; month: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
  };
}

function lastActivityDate(ledger: Ledger, today: BusinessDate): BusinessDate | null {
  let last = lastEntryDate(ledger);
  for (const card of ledger.cards) {
    if (card.archivedOn === null || card.archivedOn > today) {
      continue;
    }
    if (last === undefined || card.archivedOn > last) {
      last = card.archivedOn;
    }
  }
  return last ?? null;
}

/**
 * Доля части в целом. Не доходность и не P&L: `part / whole × 100` при whole > 0.
 */
export function shareOf(part: Money, whole: Money): PercentResult {
  if (whole.isZero()) {
    return { defined: false, reason: 'ZERO_BASE' };
  }
  if (whole.isNegative()) {
    return { defined: false, reason: 'NEGATIVE_BASE' };
  }
  return { defined: true, value: part.toDecimal().div(whole.toDecimal()).mul(100) };
}

function eachDate(from: BusinessDate, to: BusinessDate): BusinessDate[] {
  const dates: BusinessDate[] = [];
  let cursor = from;
  while (compareDates(cursor, to) <= 0) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function monthsInclusive(from: BusinessDate, to: BusinessDate): { year: number; month: number }[] {
  const start = monthOf(from);
  const end = monthOf(to);
  const months: { year: number; month: number }[] = [];
  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push({ year, month });
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function toMaterial(ledger: Ledger, card: Card, today: BusinessDate, total: Money): StatsMaterial {
  const balance = balanceAsOf(ledger, card.id, today) ?? Money.zero();
  return {
    id: card.id,
    name: card.name,
    status: isFrozen(card) ? 'frozen' : 'working',
    balance,
    change: cardBalanceChange(ledger, card, today),
    share: shareOf(balance, total),
  };
}

/**
 * Ряды и KPI из леджера. P&L только через `dailyPnl` / `monthlyPnl` / `allTimePnl`.
 * `cumulativePnlSeries` — сумма дневных P&L по календарю (T-4), не новая формула.
 *
 * @see docs/financial-model.md §5, T-4
 */
export function buildStatsFromLedger(
  ledger: Ledger,
  today: BusinessDate,
): Pick<
  StatsSnapshot,
  | 'today'
  | 'lastUpdateDate'
  | 'totalCapital'
  | 'workingCapital'
  | 'frozenCapital'
  | 'workingShare'
  | 'daily'
  | 'monthly'
  | 'allTime'
  | 'materials'
  | 'capitalSeries'
  | 'dailyPnlSeries'
  | 'cumulativePnlSeries'
  | 'monthlySeries'
  | 'windows'
> {
  const indexed = indexLedger(ledger);
  const { year, month } = monthOf(today);
  const totalCapital = capitalAsOf(indexed, today);
  const workingCapital = workingCapitalAsOf(indexed, today);
  const frozenCapital = frozenCapitalAsOf(indexed, today);
  const materials: StatsMaterial[] = [];
  for (const card of indexed.cards) {
    if (isWorking(card, today) || (isInScope(card, today) && isFrozen(card))) {
      materials.push(toMaterial(indexed, card, today, totalCapital));
    }
  }

  const first = firstEntryDate(indexed);
  const capitalSeries: CapitalPoint[] = [];
  const dailyPnlSeries: DailyPnlPoint[] = [];
  const cumulativePnlSeries: CumulativePnlPoint[] = [];
  const monthlySeries: MonthlyPnlPoint[] = [];
  let windows = emptyWindows(today);
  if (first !== undefined) {
    for (const date of uniqueObservationDates(indexed)) {
      const point = dailyPnl(indexed, date);
      if (!point.defined) {
        continue;
      }
      dailyPnlSeries.push({ date, amount: point.amount, percent: point.percent });
    }
    const dailyByDate = new Map(dailyPnlSeries.map((point) => [point.date, point.amount] as const));
    let cumulative = Money.zero();
    for (const date of eachDate(first, today)) {
      capitalSeries.push({ date, capital: capitalAsOf(indexed, date) });
      const dayPnl = dailyByDate.get(date);
      if (dayPnl !== undefined) {
        cumulative = cumulative.plus(dayPnl);
      }
      cumulativePnlSeries.push({ date, amount: cumulative });
    }
    for (const item of monthsInclusive(first, today)) {
      const pnl = monthlyPnl(indexed, item.year, item.month);
      monthlySeries.push({
        year: item.year,
        month: item.month,
        amount: pnl.amount,
        percent: pnl.percent,
      });
    }
    windows = {
      '1W': windowPnl(indexed, today, first, '1W'),
      '1M': windowPnl(indexed, today, first, '1M'),
      '3M': windowPnl(indexed, today, first, '3M'),
      '1Y': windowPnl(indexed, today, first, '1Y'),
      All: windowPnl(indexed, today, first, 'All'),
    };
  }

  return {
    today,
    lastUpdateDate: lastActivityDate(indexed, today),
    totalCapital,
    workingCapital,
    frozenCapital,
    workingShare: shareOf(workingCapital, totalCapital),
    daily: dailyPnl(indexed, today),
    monthly: monthlyPnl(indexed, year, month),
    allTime: allTimePnl(indexed, today),
    materials,
    capitalSeries,
    dailyPnlSeries,
    cumulativePnlSeries,
    monthlySeries,
    windows,
  };
}

function uniqueObservationDates(ledger: Ledger): BusinessDate[] {
  const dates: BusinessDate[] = [];
  const seen = new Set<string>();
  for (const entry of indexLedger(ledger).entries) {
    if (seen.has(entry.effectiveDate)) {
      continue;
    }
    seen.add(entry.effectiveDate);
    dates.push(entry.effectiveDate);
  }
  dates.sort(compareDates);
  return dates;
}

/**
 * Кабинет: капитал, P&L и журнал из тех же строк, что Telegram.
 */
export class StatsService {
  constructor(private readonly deps: ServiceDeps) {}

  async getSnapshot(userId: UserId, today: BusinessDate): Promise<StatsSnapshot> {
    return this.deps.uow.withUser(userId, async (tx) => {
      const [history, journal, archivedRows] = await Promise.all([
        this.deps.reports.loadUserHistory(userId, HISTORY_FROM, today, tx),
        this.deps.reports.listUserJournal(userId, tx),
        this.deps.cards.listArchived(userId, tx),
      ]);
      const ledger = { cards: history.cards, entries: history.entries };
      const names = new Map(ledger.cards.map((card) => [card.id, card.name] as const));
      const core = buildStatsFromLedger(ledger, today);
      return {
        ...core,
        journal,
        flows: history.flows.map((flow) => ({
          cardId: flow.cardId,
          cardName: names.get(flow.cardId) ?? '',
          flowDate: flow.flowDate,
          kind: flow.kind,
          amount: flow.amount,
        })),
        archived: archivedRows.flatMap((card) => toArchived(card)),
      };
    });
  }
}

function toArchived(card: CardRow): ArchivedMaterial[] {
  if (card.archivedOn === null) {
    return [];
  }
  return [
    {
      id: card.id,
      name: card.name,
      archivedOn: card.archivedOn,
      archiveReason: card.archiveReason,
    },
  ];
}

export type { FlowEntry };
