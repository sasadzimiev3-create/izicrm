import type { Dashboard, DashboardCard } from '../../../application/dto/dashboard.js';
import { getBankEmoji } from '../../../domain/cards/bank-emoji.js';
import { formatMoney, formatMoneyDelta, formatPercent } from '../../../domain/money/format.js';
import type { PercentResult } from '../../../domain/money/percent.js';
import { Money } from '../../../domain/money/money.js';
import type { CardBalanceChange } from '../../../domain/finance/card-change.js';

import { COPY } from './copy.js';
import { formatDayMonth, formatDaysSuffix, formatMonthTitle } from './dates.js';

const EM_DASH = '\u2014';
const CARD_RULE = '────────';
const TELEGRAM_LIMIT = 4096;

export function formatCardTitle(name: string): string {
  return `${getBankEmoji(name)} ${name}`;
}

export function formatPnlLine(amount: Money, percent: PercentResult): string {
  if (!percent.defined) {
    return `${formatMoneyDelta(amount)} (${EM_DASH})`;
  }
  return `${formatMoneyDelta(amount)} / ${formatPercent(percent)}`;
}

export function formatCardChange(change: CardBalanceChange): string {
  if (!change.defined) {
    return change.reason === 'NEW_CARD' ? COPY.newCard : EM_DASH;
  }
  return formatPnlLine(change.amount, change.percent);
}

function dailyTitle(dashboard: Dashboard): string {
  const last = dashboard.lastUpdateDate;
  if (last === null) {
    return '';
  }
  const datePart = formatDayMonth(last);
  const head =
    last === dashboard.today
      ? `${COPY.todayPrefix} · ${datePart}`
      : `${COPY.lastUpdatePrefix} · ${datePart}`;
  if (dashboard.daily.defined) {
    return `${head}${formatDaysSuffix(dashboard.daily.periodDays)}`;
  }
  return head;
}

function dailyValue(dashboard: Dashboard): string {
  if (!dashboard.daily.defined) {
    return EM_DASH;
  }
  return formatPnlLine(dashboard.daily.amount, dashboard.daily.percent);
}

function renderCardBlock(card: DashboardCard): string {
  const title = formatCardTitle(card.name);
  const change = formatCardChange(card.change);
  return `${title} ${EM_DASH} ${formatMoney(card.balance)}\n${change}`;
}

function renderCardList(cards: DashboardCard[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    if (card === undefined) {
      continue;
    }
    if (i > 0) {
      lines.push(CARD_RULE);
    }
    lines.push(renderCardBlock(card));
    lines.push('');
  }
  return lines;
}

function hasFrozen(dashboard: Dashboard): boolean {
  return !dashboard.frozenCapital.isZero() || dashboard.frozenCards.length > 0;
}

/**
 * Главный экран. Чистая функция, без арифметики.
 *
 * @see docs/telegram-flows.md §1
 */
export function renderDashboard(dashboard: Dashboard): string {
  if (
    dashboard.workingCards.length === 0 &&
    dashboard.frozenCards.length === 0 &&
    dashboard.totalCapital.isZero() &&
    dashboard.lastUpdateDate === null
  ) {
    return COPY.emptyOnboarding;
  }

  const lines: string[] = [];
  lines.push(`${COPY.workingHeader}    ${formatMoney(dashboard.workingCapital)}`);
  if (hasFrozen(dashboard)) {
    lines.push(`${COPY.frozenHeader}  ${formatMoney(dashboard.frozenCapital)}`);
  }
  if (!dashboard.totalCapital.eq(dashboard.workingCapital)) {
    lines.push(`${COPY.totalHeader}      ${formatMoney(dashboard.totalCapital)}`);
  }
  lines.push('');

  const title = dailyTitle(dashboard);
  if (title !== '') {
    lines.push(`${title}        ${dailyValue(dashboard)}`);
  }
  lines.push(`${formatMonthTitle(dashboard.today)}         ${formatPnlLine(dashboard.monthly.amount, dashboard.monthly.percent)}`);
  lines.push('');

  if (dashboard.workingCards.length === 0 && dashboard.frozenCards.length === 0) {
    lines.push(COPY.allArchived);
    return lines.join('\n');
  }

  if (dashboard.workingCards.length > 0) {
    lines.push(COPY.workingHeader);
    lines.push('');
    lines.push(...renderCardList(dashboard.workingCards));
  }

  if (hasFrozen(dashboard)) {
    lines.push(COPY.frozenHeader);
    lines.push('');
    lines.push(...renderCardList(dashboard.frozenCards));
  }

  return lines.join('\n').trimEnd();
}

export function paginateText(text: string, limit = TELEGRAM_LIMIT): string[] {
  if (text.length <= limit) {
    return [text];
  }
  const pages: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut <= 0) {
      cut = limit;
    }
    pages.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length > 0) {
    pages.push(rest);
  }
  return pages;
}
