import type { PercentResult } from '../../../domain/money/percent.js';
import { formatMoney, formatMoneyDelta, formatPercent } from '../../../domain/money/format.js';
import type { Money } from '../../../domain/money/money.js';
import type { BusinessDate } from '../../../domain/finance/period.js';
import type { CardBalanceChange } from '../../../domain/finance/card-change.js';

import { COPY } from './copy.js';
import { formatDayMonth } from './dates.js';
import { formatCardChange, formatPnlLine } from './dashboard.view.js';

export type UpdateSummaryRow = {
  name: string;
  amount: Money;
  change: CardBalanceChange | null;
};

export function renderUpdateSummary(args: {
  date: BusinessDate;
  total: Money;
  dailyAmount: Money;
  dailyPercent: PercentResult;
  rows: UpdateSummaryRow[];
  skipped: number;
}): string {
  const header = COPY.updateSummaryTitle(args.rows.length, formatDayMonth(args.date));
  const block = `${formatMoney(args.total)}\n${formatPnlLine(args.dailyAmount, args.dailyPercent)}`;
  const lines = args.rows.map((row) => {
    const change =
      row.change === null || !row.change.defined
        ? ''
        : `   ${formatMoneyDelta(row.change.amount)}`;
    return `${row.name}     ${formatMoney(row.amount)}${change}`;
  });
  const parts = [header, '', block, '', ...lines];
  if (args.skipped > 0) {
    parts.push('', COPY.skippedLine(args.skipped));
  }
  return parts.join('\n');
}

export function formatChangeOrDash(change: CardBalanceChange): string {
  return formatCardChange(change);
}

export function formatPercentOrDash(result: PercentResult): string {
  return formatPercent(result);
}
