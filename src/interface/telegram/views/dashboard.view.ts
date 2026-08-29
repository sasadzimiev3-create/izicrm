import type { Dashboard, DashboardCard } from '../../../application/dto/dashboard.js';
import { getBankEmoji } from '../../../domain/cards/bank-emoji.js';
import { formatMoney, formatMoneyDelta, formatPercent } from '../../../domain/money/format.js';
import type { Money } from '../../../domain/money/money.js';
import type { PercentResult } from '../../../domain/money/percent.js';
import type { CardBalanceChange } from '../../../domain/finance/card-change.js';

import { COPY } from './copy.js';
import { bankMarkerHtml, monthMarkerHtml, todayMarkerHtml } from './custom-emoji.js';
import { formatDayMonth, formatDaysSuffix, formatMonthTitle } from './dates.js';

const EM_DASH = '\u2014';
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

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function underline(text: string): string {
  return `<u>${text}</u>`;
}

function boldUnderline(text: string): string {
  return `<u><b>${text}</b></u>`;
}

function dailyTitle(dashboard: Dashboard): string {
  const last = dashboard.lastUpdateDate;
  if (last === null) {
    return '';
  }
  const head = last === dashboard.today ? COPY.todayPrefix : `За ${formatDayMonth(last)}`;
  const suffix = dashboard.daily.defined ? formatDaysSuffix(dashboard.daily.periodDays) : '';
  return `${todayMarkerHtml()}${head}${suffix}:`;
}

function dailyValue(dashboard: Dashboard): string {
  if (!dashboard.daily.defined) {
    return EM_DASH;
  }
  return formatPnlLine(dashboard.daily.amount, dashboard.daily.percent);
}

function renderCardBlock(card: DashboardCard): string {
  const change = formatCardChange(card.change);
  const title = `${bankMarkerHtml(card.name)} ${escapeHtml(card.name)}`;
  return `${title} ${EM_DASH} ${formatMoney(card.balance)}\n${change}`;
}

function renderCardList(cards: DashboardCard[]): string[] {
  const lines: string[] = [];
  for (const card of cards) {
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
 * Жирный/подчёркивание и custom emoji — Telegram HTML (`parse_mode: HTML`).
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
  lines.push(boldUnderline(COPY.totalLine(formatMoney(dashboard.totalCapital))));
  if (hasFrozen(dashboard)) {
    lines.push('');
    lines.push(COPY.workingSummary(formatMoney(dashboard.workingCapital)));
    lines.push(COPY.frozenSummary(formatMoney(dashboard.frozenCapital)));
  }
  lines.push(COPY.sectionRule);

  lines.push(`${monthMarkerHtml()}За ${formatMonthTitle(dashboard.today)}:`);
  lines.push(formatPnlLine(dashboard.monthly.amount, dashboard.monthly.percent));

  const title = dailyTitle(dashboard);
  if (title !== '') {
    lines.push('');
    lines.push(title);
    lines.push(dailyValue(dashboard));
  }

  if (dashboard.workingCards.length === 0 && dashboard.frozenCards.length === 0) {
    lines.push('');
    lines.push(COPY.allArchived);
    return lines.join('\n').trimEnd();
  }

  lines.push(COPY.sectionRule);

  if (dashboard.workingCards.length > 0) {
    lines.push(boldUnderline(COPY.workingHeader));
    lines.push(...renderCardList(dashboard.workingCards));
  }

  if (hasFrozen(dashboard)) {
    lines.push(underline(COPY.frozenHeader));
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
