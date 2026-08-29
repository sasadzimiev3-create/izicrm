import { describe, expect, it } from 'vitest';

import type { Dashboard, DashboardCard } from '../../../src/application/dto/dashboard.js';
import { cardId } from '../../../src/domain/cards/card.js';
import type { CardBalanceChange } from '../../../src/domain/finance/card-change.js';
import { parseBusinessDate } from '../../../src/domain/finance/period.js';
import { Money } from '../../../src/domain/money/money.js';
import { percentChange } from '../../../src/domain/money/percent.js';
import { formatCardTitle, renderDashboard } from '../../../src/interface/telegram/views/dashboard.view.js';
import { COPY } from '../../../src/interface/telegram/views/copy.js';
import { CARD_EMOJI, CUSTOM_EMOJI_ID } from '../../../src/interface/telegram/views/custom-emoji.js';

const NARROW = '\u202F';
const EM_DASH = '\u2014';
const D = parseBusinessDate;

function change(amount: string, base: string): CardBalanceChange {
  const money = Money.from(amount);
  return { defined: true, amount: money, percent: percentChange(money, Money.from(base)) };
}

function card(params: {
  id: number;
  name: string;
  icon: string | null;
  balance: string;
  change: CardBalanceChange;
}): DashboardCard {
  return {
    id: cardId(params.id),
    name: params.name,
    icon: params.icon,
    balance: Money.from(params.balance),
    change: params.change,
  };
}

function dashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  const today = D('2024-08-20');
  const dailyAmount = Money.from('327');
  const monthlyAmount = Money.from('10562');
  const base: Dashboard = {
    today,
    lastUpdateDate: today,
    workingCapital: Money.from('681466'),
    frozenCapital: Money.from('318861'),
    totalCapital: Money.from('1000327'),
    daily: {
      defined: true,
      amount: dailyAmount,
      percent: percentChange(dailyAmount, Money.from('1000000')),
      openingCapital: Money.from('1000000'),
      closingCapital: Money.from('1000327'),
      netFlow: Money.zero(),
      prevDate: D('2024-08-19'),
      periodDays: 1,
    },
    monthly: {
      amount: monthlyAmount,
      percent: percentChange(monthlyAmount, Money.from('989765')),
      openingCapital: Money.from('989765'),
      closingCapital: Money.from('1000327'),
      netFlow: Money.zero(),
    },
    workingCards: [
      card({
        id: 1,
        name: 'Сбер 7121*',
        icon: '🟢',
        balance: '124276',
        change: change('200', '124076'),
      }),
      card({
        id: 2,
        name: 'Втб 0134*',
        icon: '🔵',
        balance: '557190',
        change: change('0', '557190'),
      }),
    ],
    frozenCards: [
      card({
        id: 3,
        name: 'Альфа 7131*',
        icon: '🔴',
        balance: '318861',
        change: change('127', '318734'),
      }),
    ],
  };
  return { ...base, ...overrides };
}

describe('UI-01 снимки главного экрана', () => {
  it('обычный экран: T-6 сумма материалов = всего, UI-14 формат', () => {
    const vm = dashboard();
    expect(vm.workingCapital.plus(vm.frozenCapital).eq(vm.totalCapital)).toBe(true);
    const text = renderDashboard(vm);
    expect(text).toContain(`1${NARROW}000${NARROW}327 ₽`);
    expect(text).toContain(`681${NARROW}466 ₽`);
    expect(text).toContain(`318${NARROW}861 ₽`);
    expect(text).toContain('+327 ₽ / +0.03%');
    expect(text).toContain('+1.07%');
    expect(text).toContain(`${COPY.todayPrefix}:`);
    expect(text).not.toMatch(/^\d+\) /m);
    expect(text).toContain('Сбер 7121*');
    expect(text).toContain('Втб 0134*');
    expect(text).toContain('Альфа 7131*');
    expect(text).toContain(`emoji-id="${CUSTOM_EMOJI_ID.sber}"`);
    expect(text).toContain(`emoji-id="${CUSTOM_EMOJI_ID.vtb}"`);
    expect(text).toContain(`emoji-id="${CUSTOM_EMOJI_ID.alfa}"`);
    expect(text).toContain(`emoji-id="${CUSTOM_EMOJI_ID.working}"`);
    expect(text).toContain(`emoji-id="${CUSTOM_EMOJI_ID.month}"`);
    expect(text).toContain(`emoji-id="${CUSTOM_EMOJI_ID.today}"`);
    expect(text).toContain(`<u><b>${COPY.totalLine(`1${NARROW}000${NARROW}327 ₽`)}</b></u>`);
    expect(text).toContain(COPY.workingSummary(`681${NARROW}466 ₽`));
    expect(text).not.toMatch(/<b>В работе:/);
    expect(text).toContain(COPY.frozenSummary(`318${NARROW}861 ₽`));
    expect(text).not.toMatch(/\[.+В работе:/);
    expect(text).not.toMatch(/\[🧊Заморожено:/);
    expect(text).toContain(`<b>${COPY.workingHeader}</b>`);
    expect(text).not.toMatch(`<u><b>${COPY.workingHeader}</b></u>`);
    expect(text).toContain(`<u>${COPY.frozenHeader}</u>`);
    expect(text).toContain(COPY.sectionRule);
    expect(COPY.sectionRule).toHaveLength(34);
    expect(text).toContain('+200 ₽ / +0.16%');
    expect(text).not.toMatch(/\[\+/);
    const lines = text.split('\n');
    const workingIdx = lines.findIndex((line) => line.includes(`<b>${COPY.workingHeader}</b>`));
    expect(lines[workingIdx + 1]).toContain('Сбер 7121*');
    expect(lines[workingIdx + 1]).not.toMatch(/^\d+\)/);
    expect(text.indexOf('За Август:')).toBeLessThan(text.indexOf(`${COPY.todayPrefix}:`));
    expect(text).toMatchSnapshot();
  });

  it('разрез скрывается, если нет замороженного — «Всего» остаётся в шапке', () => {
    const text = renderDashboard(
      dashboard({
        frozenCapital: Money.zero(),
        frozenCards: [],
        workingCapital: Money.from('681466'),
        totalCapital: Money.from('681466'),
      }),
    );
    expect(text).toContain(COPY.totalLine(`681${NARROW}466 ₽`));
    expect(text).not.toContain(COPY.workingSummary(`681${NARROW}466 ₽`));
    expect(text).not.toContain(COPY.frozenHeader);
  });

  it('без материалов — онбординг', () => {
    const text = renderDashboard(
      dashboard({
        lastUpdateDate: null,
        workingCapital: Money.zero(),
        frozenCapital: Money.zero(),
        totalCapital: Money.zero(),
        workingCards: [],
        frozenCards: [],
        daily: { defined: false, reason: 'NO_PREVIOUS_DATA' },
      }),
    );
    expect(text).toBe(COPY.emptyOnboarding);
    expect(text).toMatchSnapshot();
  });

  it('все архивированы: 0 ₽ и —', () => {
    const text = renderDashboard(
      dashboard({
        workingCapital: Money.zero(),
        frozenCapital: Money.zero(),
        totalCapital: Money.zero(),
        workingCards: [],
        frozenCards: [],
        daily: { defined: false, reason: 'NO_PREVIOUS_DATA' },
      }),
    );
    expect(text).toContain('0 ₽');
    expect(text).toContain(EM_DASH);
    expect(text).toMatchSnapshot();
  });

  it('нет предыдущего дня: P&L —', () => {
    const text = renderDashboard(
      dashboard({
        daily: { defined: false, reason: 'NO_PREVIOUS_DATA' },
      }),
    );
    expect(text).toContain(EM_DASH);
    expect(text).toMatchSnapshot();
  });

  it('есть замороженные и все заморожены', () => {
    const withFrozen = renderDashboard(dashboard());
    expect(withFrozen).toContain(COPY.frozenHeader);
    const allFrozen = renderDashboard(
      dashboard({
        workingCapital: Money.zero(),
        workingCards: [],
      }),
    );
    expect(allFrozen).toContain(`0 ₽`);
    expect(allFrozen).toContain('Альфа 7131*');
    expect(allFrozen).not.toMatch(/^\d+\) /m);
    expect(allFrozen).not.toContain(`<b>${COPY.workingHeader}</b>`);
    const frozenIdx = allFrozen.split('\n').indexOf(`<u>${COPY.frozenHeader}</u>`);
    expect(allFrozen.split('\n')[frozenIdx + 1]).toContain('Альфа 7131*');
    expect(allFrozen).toMatchSnapshot();
  });
});

describe('UI-02 / UI-03 / UI-04', () => {
  it('UI-02: база процента ≤ 0 → — , не 0%', () => {
    const amount = Money.from('30000');
    const text = renderDashboard(
      dashboard({
        daily: {
          defined: true,
          amount,
          percent: { defined: false, reason: 'ZERO_BASE' },
          openingCapital: Money.zero(),
          closingCapital: amount,
          netFlow: Money.zero(),
          prevDate: D('2024-08-19'),
          periodDays: 1,
        },
      }),
    );
    expect(text).toContain(`+30${NARROW}000 ₽ (${EM_DASH})`);
    expect(text).not.toMatch(/\+30\u202F000 ₽ \/ 0/);
  });

  it('UI-03: «За сегодня» против даты последнего обновления', () => {
    const today = renderDashboard(dashboard({ lastUpdateDate: D('2024-08-20'), today: D('2024-08-20') }));
    expect(today).toContain(`${COPY.todayPrefix}:`);
    expect(today).not.toContain('За 20 августа:');
    const older = renderDashboard(dashboard({ lastUpdateDate: D('2024-08-16'), today: D('2024-08-20') }));
    expect(older).toContain('За 16 августа:');
    expect(older).not.toContain(`${COPY.todayPrefix}:`);
  });

  it('UI-04: подпись за N дней при пропущенных днях', () => {
    const amount = Money.from('327');
    const text = renderDashboard(
      dashboard({
        daily: {
          defined: true,
          amount,
          percent: percentChange(amount, Money.from('1000000')),
          openingCapital: Money.from('1000000'),
          closingCapital: Money.from('1000327'),
          netFlow: Money.zero(),
          prevDate: D('2024-08-16'),
          periodDays: 4,
        },
      }),
    );
    expect(text).toContain('за 4 дня');
  });
});

describe('вёрстка строки материала', () => {
  it('маркер банка берётся из названия, не из сохранённой иконки', () => {
    expect(formatCardTitle('Сбер')).toBe('🟢 Сбер');
    expect(formatCardTitle('Втб2312')).toBe('🔵 Втб2312');
    expect(formatCardTitle('Альфа-Банк')).toBe('🔴 Альфа-Банк');
    expect(formatCardTitle('Тинькофф')).toBe('🟡 Тинькофф');
    expect(formatCardTitle('ОТП')).toBe('🟠 ОТП');
    expect(formatCardTitle('Газпром')).toBe(`${CARD_EMOJI} Газпром`);
  });

  it('месячный блок есть, даже если дневной P&L ещё «—»', () => {
    const text = renderDashboard(
      dashboard({
        daily: { defined: false, reason: 'NO_PREVIOUS_DATA' },
      }),
    );
    expect(text).toContain('За Август:');
    expect(text).toContain('+10 562 ₽ / +1.07%');
    expect(text).toContain(`${COPY.todayPrefix}:`);
    expect(text).toContain(EM_DASH);
  });

  it('имя с HTML-символами экранируется', () => {
    const text = renderDashboard(
      dashboard({
        frozenCapital: Money.zero(),
        frozenCards: [],
        workingCapital: Money.from('124276'),
        totalCapital: Money.from('124276'),
        workingCards: [
          card({
            id: 1,
            name: 'Сбер <x>',
            icon: null,
            balance: '124276',
            change: change('200', '124076'),
          }),
        ],
      }),
    );
    expect(text).toContain('Сбер &lt;x&gt;');
    expect(text).not.toContain('Сбер <x>');
  });

  it('неизвестный банк — обычный 💳, без custom emoji банка', () => {
    const text = renderDashboard(
      dashboard({
        frozenCapital: Money.zero(),
        frozenCards: [],
        workingCapital: Money.from('124276'),
        totalCapital: Money.from('124276'),
        workingCards: [
          card({
            id: 1,
            name: 'Наличные',
            icon: null,
            balance: '124276',
            change: change('200', '124076'),
          }),
        ],
      }),
    );
    expect(text).toContain(`${CARD_EMOJI} Наличные`);
    expect(text).not.toContain(`emoji-id="${CUSTOM_EMOJI_ID.sber}"`);
    expect(text).toContain(`<b>${COPY.workingHeader}</b>`);
  });

  it('ОТП и Тинькофф получают свои custom emoji', () => {
    const text = renderDashboard(
      dashboard({
        frozenCapital: Money.zero(),
        frozenCards: [],
        workingCapital: Money.from('100'),
        totalCapital: Money.from('100'),
        workingCards: [
          card({
            id: 1,
            name: 'ОТП 11',
            icon: null,
            balance: '50',
            change: change('0', '50'),
          }),
          card({
            id: 2,
            name: 'Тинькофф',
            icon: null,
            balance: '50',
            change: change('0', '50'),
          }),
        ],
      }),
    );
    expect(text).toContain(`emoji-id="${CUSTOM_EMOJI_ID.otp}"`);
    expect(text).toContain(`emoji-id="${CUSTOM_EMOJI_ID.tbank}"`);
    expect(text).not.toMatch(/^\d+\) /m);
  });

  it('у только что созданного материала нет подписи «новый»', () => {
    const text = renderDashboard(
      dashboard({
        frozenCapital: Money.zero(),
        frozenCards: [],
        workingCapital: Money.from('124276'),
        totalCapital: Money.from('124276'),
        workingCards: [
          card({
            id: 1,
            name: 'Сбер 7121*',
            icon: null,
            balance: '124276',
            change: { defined: false, reason: 'NEW_CARD' },
          }),
        ],
      }),
    );
    expect(text).toContain('Сбер 7121*');
    expect(text).not.toContain('новый');
    expect(text).not.toMatch(/Сбер 7121\*.*\nновый/s);
  });
});
