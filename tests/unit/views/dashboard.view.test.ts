import { describe, expect, it } from 'vitest';

import type { Dashboard, DashboardCard } from '../../../src/application/dto/dashboard.js';
import { cardId } from '../../../src/domain/cards/card.js';
import type { CardBalanceChange } from '../../../src/domain/finance/card-change.js';
import { parseBusinessDate } from '../../../src/domain/finance/period.js';
import { Money } from '../../../src/domain/money/money.js';
import { percentChange } from '../../../src/domain/money/percent.js';
import { formatCardTitle, renderDashboard } from '../../../src/interface/telegram/views/dashboard.view.js';
import { COPY } from '../../../src/interface/telegram/views/copy.js';

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
    expect(text).toContain(COPY.todayPrefix);
    expect(text).toContain('🟢 Сбер 7121*');
    expect(text).toContain('🔴 Альфа 7131*');
    expect(text).toMatchSnapshot();
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

  it('UI-03: СЕГОДНЯ против ПОСЛЕДНЕЕ ОБНОВЛЕНИЕ', () => {
    const today = renderDashboard(dashboard({ lastUpdateDate: D('2024-08-20'), today: D('2024-08-20') }));
    expect(today).toContain(COPY.todayPrefix);
    expect(today).not.toContain(COPY.lastUpdatePrefix);
    const older = renderDashboard(dashboard({ lastUpdateDate: D('2024-08-16'), today: D('2024-08-20') }));
    expect(older).toContain(COPY.lastUpdatePrefix);
    expect(older).toContain('16 августа');
    expect(older).not.toContain(`${COPY.todayPrefix} ·`);
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

describe('вёрстка строки без стикера (FR-2.13)', () => {
  it('пустой icon не ломает строку', () => {
    expect(formatCardTitle(null, 'Сбер')).toBe('Сбер');
    expect(formatCardTitle('', 'Сбер')).toBe('Сбер');
    expect(formatCardTitle('🟢', 'Сбер')).toBe('🟢 Сбер');
  });
});
