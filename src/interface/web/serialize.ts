import { detectBankKind } from '../../domain/cards/bank-emoji.js';
import type { CardBalanceChange } from '../../domain/finance/card-change.js';
import type { AllTimePnl, DailyPnl, PeriodPnl } from '../../domain/finance/pnl.js';
import { formatMoney, formatMoneyDelta, formatPercent, formatSharePercent } from '../../domain/money/format.js';
import { Decimal, type Money } from '../../domain/money/money.js';
import type { PercentResult } from '../../domain/money/percent.js';
import type { ArchiveReason } from '../../domain/cards/card.js';
import type { BalanceEntrySource } from '../../application/ports/balance-repository.js';
import type { JournalEntry, StatsSnapshot } from '../../application/dto/stats.js';

const EM_DASH = '\u2014';

const SOURCE_LABEL: Record<BalanceEntrySource, string> = {
  CARD_CREATED: 'Создание',
  DAILY_UPDATE: 'Обновление',
  TOP_UP: 'Пополнение',
  SPEND: 'Вывод',
  CORRECTION: 'Исправление',
  ARCHIVE_TRANSFER_IN: 'Перевод',
  ARCHIVE_ZERO_OUT: 'Обнуление',
};

const KIND_LABEL = {
  FREEZE: 'Заморозка',
  UNFREEZE: 'Разморозка',
  ARCHIVE: 'Удаление',
} as const;

const ARCHIVE_REASON_LABEL: Record<ArchiveReason, string> = {
  WITHDRAWN: 'вывел',
  TRANSFERRED: 'перевод',
  LOST: 'потеря',
};

const FIXABLE_SOURCES = new Set<BalanceEntrySource>([
  'CARD_CREATED',
  'DAILY_UPDATE',
  'TOP_UP',
  'SPEND',
  'CORRECTION',
]);

function journalLabel(row: JournalEntry): string {
  if (row.kind === 'BALANCE' && row.source !== null) {
    return SOURCE_LABEL[row.source];
  }
  if (row.kind === 'ARCHIVE') {
    const extra = row.archiveReason ? ARCHIVE_REASON_LABEL[row.archiveReason] : '';
    return extra === '' ? KIND_LABEL.ARCHIVE : `${KIND_LABEL.ARCHIVE} · ${extra}`;
  }
  if (row.kind === 'FREEZE' || row.kind === 'UNFREEZE') {
    return KIND_LABEL[row.kind];
  }
  return row.kind;
}

export type MoneyView = {
  amount: string;
  formatted: string;
  delta: string;
};

export type PercentView =
  | { defined: true; formatted: string; value: string }
  | { defined: false; formatted: string };

function moneyView(amount: Money): MoneyView {
  return {
    amount: amount.toFixed(),
    formatted: formatMoney(amount),
    delta: formatMoneyDelta(amount),
  };
}

function percentView(result: PercentResult): PercentView {
  if (!result.defined) {
    return { defined: false, formatted: EM_DASH };
  }
  return {
    defined: true,
    formatted: formatPercent(result),
    value: result.value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
  };
}

function shareView(result: PercentResult): PercentView {
  if (!result.defined) {
    return { defined: false, formatted: EM_DASH };
  }
  return {
    defined: true,
    formatted: formatSharePercent(result),
    value: result.value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
  };
}

function changeView(change: CardBalanceChange): { defined: boolean; formatted: string; amount?: MoneyView } {
  if (!change.defined) {
    return { defined: false, formatted: change.reason === 'NEW_CARD' ? 'новый' : EM_DASH };
  }
  const amount = moneyView(change.amount);
  return {
    defined: true,
    formatted: `${amount.delta} (${percentView(change.percent).formatted})`,
    amount,
  };
}

function periodView(pnl: PeriodPnl): { amount: MoneyView; percent: PercentView } {
  return { amount: moneyView(pnl.amount), percent: percentView(pnl.percent) };
}

function dailyView(pnl: DailyPnl): { defined: boolean; formatted: string; amount?: MoneyView; percent?: PercentView } {
  if (!pnl.defined) {
    return { defined: false, formatted: EM_DASH };
  }
  const amount = moneyView(pnl.amount);
  const percent = percentView(pnl.percent);
  return {
    defined: true,
    formatted: `${amount.delta} (${percent.formatted})`,
    amount,
    percent,
  };
}

function allTimeView(pnl: AllTimePnl): {
  defined: boolean;
  formatted: string;
  amount?: MoneyView;
  percent?: PercentView;
  deposits?: MoneyView;
  withdrawals?: MoneyView;
} {
  if (!pnl.defined) {
    return { defined: false, formatted: EM_DASH };
  }
  return {
    defined: true,
    formatted: `${moneyView(pnl.amount).delta} (${percentView(pnl.percent).formatted})`,
    amount: moneyView(pnl.amount),
    percent: percentView(pnl.percent),
    deposits: moneyView(pnl.totalDeposits),
    withdrawals: moneyView(pnl.totalWithdrawals),
  };
}

/**
 * Граница вывода: деньги остаются строками. Number — только в браузере для canvas.
 */
export function serializeSnapshot(snapshot: StatsSnapshot): Record<string, unknown> {
  return {
    today: snapshot.today,
    lastUpdateDate: snapshot.lastUpdateDate,
    totalCapital: moneyView(snapshot.totalCapital),
    workingCapital: moneyView(snapshot.workingCapital),
    frozenCapital: moneyView(snapshot.frozenCapital),
    workingShare: shareView(snapshot.workingShare),
    daily: dailyView(snapshot.daily),
    monthly: periodView(snapshot.monthly),
    allTime: allTimeView(snapshot.allTime),
    materials: snapshot.materials.map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      bank: detectBankKind(item.name),
      balance: moneyView(item.balance),
      change: changeView(item.change),
      share: shareView(item.share),
    })),
    capitalSeries: snapshot.capitalSeries.map((point) => ({
      date: point.date,
      capital: point.capital.toFixed(),
      formatted: formatMoney(point.capital),
    })),
    dailyPnlSeries: snapshot.dailyPnlSeries.map((point) => ({
      date: point.date,
      amount: point.amount.toFixed(),
      formatted: formatMoneyDelta(point.amount),
      percent: percentView(point.percent),
    })),
    cumulativePnlSeries: snapshot.cumulativePnlSeries.map((point) => ({
      date: point.date,
      amount: point.amount.toFixed(),
      formatted: formatMoneyDelta(point.amount),
    })),
    monthlySeries: snapshot.monthlySeries.map((point) => ({
      year: point.year,
      month: point.month,
      amount: point.amount.toFixed(),
      formatted: formatMoneyDelta(point.amount),
      percent: percentView(point.percent),
    })),
    windows: Object.fromEntries(
      (['1W', '1M', '3M', '1Y', 'All'] as const).map((key) => {
        const item = snapshot.windows[key];
        return [
          key,
          {
            from: item.from,
            to: item.to,
            amount: moneyView(item.amount),
            percent: percentView(item.percent),
            closing: moneyView(item.closing),
          },
        ];
      }),
    ),
    journal: snapshot.journal.map((row) => ({
      kind: row.kind,
      at: row.at.toISOString(),
      cardId: row.cardId,
      cardName: row.cardName,
      date: row.effectiveDate,
      amount: row.amount ? moneyView(row.amount) : null,
      capitalIn: row.capitalIn ? moneyView(row.capitalIn) : null,
      capitalOut: row.capitalOut ? moneyView(row.capitalOut) : null,
      source: row.source,
      sourceLabel: journalLabel(row),
      canFix: row.kind === 'BALANCE' && row.source !== null && FIXABLE_SOURCES.has(row.source),
    })),
    flows: snapshot.flows.map((row) => ({
      cardId: row.cardId,
      cardName: row.cardName,
      date: row.flowDate,
      kind: row.kind,
      kindLabel: row.kind === 'DEPOSIT' ? 'Депозит' : 'Вывод',
      amount: moneyView(row.amount),
    })),
    archived: snapshot.archived.map((row) => ({
      id: row.id,
      name: row.name,
      archivedOn: row.archivedOn,
      reason: row.archiveReason,
      reasonLabel: ARCHIVE_REASON_LABEL[row.archiveReason],
    })),
  };
}
