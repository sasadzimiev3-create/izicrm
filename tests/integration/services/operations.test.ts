import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../src/domain/errors.js';
import { parseBusinessDate } from '../../../src/domain/finance/period.js';
import { Money } from '../../../src/domain/money/money.js';
import { insertUser, useAppDb } from '../harness.js';
import { parseUserId } from '../../../src/infrastructure/db/ids.js';

import { createTestApp, unwrap } from './app.js';

const D = parseBusinessDate;

describe('пополнение, трата, заморозка, обновление', () => {
  const db = useAppDb();

  it('пополнение Y > текущего не меняет P&L; Y ≤ текущего отклоняется (T-10)', async () => {
    const app = createTestApp(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '51201'));
    const card = unwrap(
      await app.card.create(userId, {
        name: 'Сбер',
        amount: Money.from('80000.00'),
        icon: null,
        createdOn: D('2024-08-19'),
      }),
    );
    unwrap(
      await app.topup.topUp(userId, {
        cardId: card.id,
        newAmount: Money.from('90000.00'),
        businessDate: D('2024-08-20'),
      }),
    );
    const dash = await app.dashboard.getDashboard(userId, D('2024-08-20'));
    expect(dash.totalCapital.toFixed()).toBe('90000.00');
    expect(dash.daily.defined).toBe(true);
    if (dash.daily.defined) {
      expect(dash.daily.amount.toFixed()).toBe('0.00');
    }

    await expect(
      app.topup.topUp(userId, {
        cardId: card.id,
        newAmount: Money.from('90000.00'),
        businessDate: D('2024-08-20'),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('трата Y < текущего не меняет P&L и не архивирует карту при Y = 0 (T-12)', async () => {
    const app = createTestApp(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '51202'));
    const card = unwrap(
      await app.card.create(userId, {
        name: 'Сбер',
        amount: Money.from('80000.00'),
        icon: null,
        createdOn: D('2024-08-19'),
      }),
    );
    unwrap(
      await app.spend.spend(userId, {
        cardId: card.id,
        newAmount: Money.from('0.00'),
        businessDate: D('2024-08-20'),
      }),
    );
    const dash = await app.dashboard.getDashboard(userId, D('2024-08-20'));
    expect(dash.totalCapital.toFixed()).toBe('0.00');
    expect(dash.workingCards).toHaveLength(1);
    expect(dash.workingCards[0]?.balance.toFixed()).toBe('0.00');
    if (dash.daily.defined) {
      expect(dash.daily.amount.toFixed()).toBe('0.00');
    }
    const still = await app.card.getUserCard(userId, card.id);
    expect(still?.archivedOn).toBeNull();
  });

  it('заморозка не меняет капитал и P&L; замороженные не в очереди «обновить все» (T-11)', async () => {
    const app = createTestApp(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '51203'));
    const working = unwrap(
      await app.card.create(userId, {
        name: 'В работе',
        amount: Money.from('10000.00'),
        icon: null,
        createdOn: D('2024-08-19'),
      }),
    );
    const frozen = unwrap(
      await app.card.create(userId, {
        name: 'Заморожен',
        amount: Money.from('20000.00'),
        icon: null,
        createdOn: D('2024-08-19'),
      }),
    );
    unwrap(
      await app.balanceUpdate.update(userId, {
        cardId: working.id,
        amount: Money.from('11000.00'),
        businessDate: D('2024-08-20'),
      }),
    );
    unwrap(
      await app.freeze.freeze(userId, { cardId: frozen.id, frozenOn: D('2024-08-20') }),
    );

    const dash = await app.dashboard.getDashboard(userId, D('2024-08-20'));
    expect(dash.workingCapital.toFixed()).toBe('11000.00');
    expect(dash.frozenCapital.toFixed()).toBe('20000.00');
    expect(dash.workingCapital.plus(dash.frozenCapital).eq(dash.totalCapital)).toBe(true);
    expect(dash.totalCapital.toFixed()).toBe('31000.00');
    expect(dash.workingCards).toHaveLength(1);
    expect(dash.frozenCards).toHaveLength(1);
    if (dash.daily.defined) {
      expect(dash.daily.amount.toFixed()).toBe('1000.00');
    }

    const queue = await app.balanceUpdate.listWorkingQueue(userId, D('2024-08-20'));
    expect(queue.map((card) => card.id)).toEqual([working.id]);

    await expect(
      app.topup.topUp(userId, {
        cardId: frozen.id,
        newAmount: Money.from('25000.00'),
        businessDate: D('2024-08-20'),
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    unwrap(await app.freeze.unfreeze(userId, { cardId: frozen.id }));
    const after = await app.dashboard.getDashboard(userId, D('2024-08-20'));
    expect(after.frozenCards).toHaveLength(0);
    expect(after.workingCards).toHaveLength(2);
    expect(after.totalCapital.toFixed()).toBe('31000.00');
  });

  it('T-6: сумма материалов равна общему капиталу', async () => {
    const app = createTestApp(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '51204'));
    unwrap(
      await app.card.create(userId, {
        name: 'А',
        amount: Money.from('124276.00'),
        icon: '🟢',
        createdOn: D('2024-08-20'),
      }),
    );
    unwrap(
      await app.card.create(userId, {
        name: 'Б',
        amount: Money.from('318861.00'),
        icon: '🔴',
        createdOn: D('2024-08-20'),
      }),
    );
    const frozen = unwrap(
      await app.card.create(userId, {
        name: 'В',
        amount: Money.from('557190.00'),
        icon: '🔵',
        createdOn: D('2024-08-20'),
      }),
    );
    unwrap(await app.freeze.freeze(userId, { cardId: frozen.id, frozenOn: D('2024-08-20') }));

    const dash = await app.dashboard.getDashboard(userId, D('2024-08-20'));
    const listed = [...dash.workingCards, ...dash.frozenCards].reduce(
      (sum, card) => sum.plus(card.balance),
      Money.zero(),
    );
    expect(listed.eq(dash.totalCapital)).toBe(true);
    expect(dash.workingCapital.plus(dash.frozenCapital).eq(dash.totalCapital)).toBe(true);
  });
});
