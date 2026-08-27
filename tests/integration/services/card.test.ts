import { describe, expect, it } from 'vitest';

import { ConflictError, NotFoundError } from '../../../src/domain/errors.js';
import { parseBusinessDate } from '../../../src/domain/finance/period.js';
import { Money } from '../../../src/domain/money/money.js';
import { cardId } from '../../../src/domain/cards/card.js';
import { insertUser, useAppDb, withUser } from '../harness.js';
import { parseUserId } from '../../../src/infrastructure/db/ids.js';

import { createTestApp, unwrap } from './app.js';

const D = parseBusinessDate;

describe('CardService', () => {
  const db = useAppDb();

  it('создаёт карту с депозитом capital_in = amount; стикер пользователя не пишется', async () => {
    const app = createTestApp(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '51001'));

    const created = unwrap(
      await app.card.create(userId, {
        name: 'Сбер1',
        amount: Money.from('10000.00'),
        icon: '🟢',
        createdOn: D('2024-08-20'),
      }),
    );
    expect(created.name).toBe('Сбер1');
    expect(created.icon).toBeNull();

    const dash = await app.dashboard.getDashboard(userId, D('2024-08-20'));
    expect(dash.totalCapital.toFixed()).toBe('10000.00');
    expect(dash.daily.defined).toBe(false);
    expect(dash.workingCards).toHaveLength(1);
    expect(dash.workingCards[0]?.icon).toBeNull();
  });

  it('поле icon всегда null, даже если в команде передали текст', async () => {
    const app = createTestApp(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '51002'));

    const created = unwrap(
      await app.card.create(userId, {
        name: 'Без стикера',
        amount: Money.from('1.00'),
        icon: 'не эмодзи',
        createdOn: D('2024-08-20'),
      }),
    );
    expect(created.icon).toBeNull();

    const dash = await app.dashboard.getDashboard(userId, D('2024-08-20'));
    expect(dash.workingCards).toHaveLength(1);
    expect(dash.workingCards[0]?.icon).toBeNull();
  });

  it('дубль названия среди активных запрещён; после архива имя свободно (C-6)', async () => {
    const app = createTestApp(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '51003'));
    const first = unwrap(
      await app.card.create(userId, {
        name: 'Сбер1',
        amount: Money.zero(),
        icon: null,
        createdOn: D('2024-08-20'),
      }),
    );
    await expect(
      app.card.create(userId, {
        name: ' сбер1 ',
        amount: Money.zero(),
        icon: null,
        createdOn: D('2024-08-20'),
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    unwrap(
      await app.archive.archive(userId, {
        cardId: first.id,
        archivedOn: D('2024-08-20'),
        reason: 'WITHDRAWN',
      }),
    );
    const reused = unwrap(
      await app.card.create(userId, {
        name: 'Сбер1',
        amount: Money.zero(),
        icon: null,
        createdOn: D('2024-08-20'),
      }),
    );
    expect(reused.id).not.toBe(first.id);
  });

  it('чужой card_id даёт «Материал не найден» и не меняет данные', async () => {
    const app = createTestApp(db.pool());
    const alice = parseUserId(await insertUser(db.pool(), '51004'));
    const bob = parseUserId(await insertUser(db.pool(), '51005'));
    const bobsCard = unwrap(
      await app.card.create(bob, {
        name: 'Чужой',
        amount: Money.from('50.00'),
        icon: null,
        createdOn: D('2024-08-20'),
      }),
    );

    await expect(app.card.getUserCard(alice, bobsCard.id)).resolves.toBeNull();
    await expect(
      app.archive.archive(alice, {
        cardId: bobsCard.id,
        archivedOn: D('2024-08-20'),
        reason: 'LOST',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      app.archive.archive(alice, {
        cardId: cardId(9_999_999),
        archivedOn: D('2024-08-20'),
        reason: 'LOST',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const bobDash = await app.dashboard.getDashboard(bob, D('2024-08-20'));
    expect(bobDash.totalCapital.toFixed()).toBe('50.00');
    expect(bobDash.workingCards).toHaveLength(1);
  });
});

describe('П-8 обновление в день создания', () => {
  const db = useAppDb();

  it('депозит не переписывается, разница нового и прежнего баланса — P&L', async () => {
    const app = createTestApp(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '51006'));
    const created = unwrap(
      await app.card.create(userId, {
        name: 'Опечатка',
        amount: Money.from('30000.00'),
        icon: null,
        createdOn: D('2024-08-20'),
      }),
    );
    unwrap(
      await app.balanceUpdate.update(userId, {
        cardId: created.id,
        amount: Money.from('35000.00'),
        businessDate: D('2024-08-20'),
      }),
    );

    const dash = await app.dashboard.getDashboard(userId, D('2024-08-20'));
    expect(dash.totalCapital.toFixed()).toBe('35000.00');
    expect(dash.monthly.amount.toFixed()).toBe('5000.00');

    unwrap(
      await app.balanceUpdate.update(userId, {
        cardId: created.id,
        amount: Money.from('25000.00'),
        businessDate: D('2024-08-20'),
      }),
    );
    const down = await app.dashboard.getDashboard(userId, D('2024-08-20'));
    expect(down.totalCapital.toFixed()).toBe('25000.00');
    expect(down.monthly.amount.toFixed()).toBe('-5000.00');

    const history = await app.uow.withUser(userId, (tx) =>
      app.reports.loadUserHistory(userId, D('2024-08-01'), D('2024-08-31'), tx),
    );
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]?.amount.toFixed()).toBe('25000.00');
    expect(history.entries[0]?.capitalIn.toFixed()).toBe('30000.00');
    expect(history.flows).toHaveLength(1);
    expect(history.flows[0]?.amount.toFixed()).toBe('30000.00');

    const totalRows = await withUser(db.pool(), String(userId), async (client) => {
      const result = await client.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM balance_entries WHERE user_id = $1 AND card_id = $2',
        [String(userId), String(created.id)],
      );
      return result.rows[0]?.n;
    });
    expect(totalRows).toBe('3');
  });
});
