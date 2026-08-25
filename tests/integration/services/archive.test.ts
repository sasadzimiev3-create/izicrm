import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../src/domain/errors.js';
import { parseBusinessDate } from '../../../src/domain/finance/period.js';
import { Money } from '../../../src/domain/money/money.js';
import { insertUser, useAppDb } from '../harness.js';
import { parseUserId } from '../../../src/infrastructure/db/ids.js';

import { createTestApp, unwrap } from './app.js';

const D = parseBusinessDate;

async function seedPair(telegramId: string, pool: ReturnType<typeof useAppDb>['pool']) {
  const app = createTestApp(pool());
  const userId = parseUserId(await insertUser(pool(), telegramId));
  const sber1 = unwrap(
    await app.card.create(userId, {
      name: 'Сбер1',
      amount: Money.from('10000.00'),
      icon: null,
      createdOn: D('2024-08-19'),
    }),
  );
  const sber2 = unwrap(
    await app.card.create(userId, {
      name: 'Сбер2',
      amount: Money.from('20000.00'),
      icon: null,
      createdOn: D('2024-08-19'),
    }),
  );
  return { app, userId, sber1, sber2 };
}

function dailyAmount(dashboard: Awaited<ReturnType<ReturnType<typeof createTestApp>['dashboard']['getDashboard']>>) {
  if (!dashboard.daily.defined) {
    throw new Error('expected defined daily P&L');
  }
  return dashboard.daily.amount;
}

describe('архивирование: три причины на одних данных (T-9)', () => {
  const db = useAppDb();

  it('PnL(TRANSFERRED) = PnL(WITHDRAWN) = PnL(LOST) + X', async () => {
    const transferred = await seedPair('51101', db.pool);
    unwrap(
      await transferred.app.archive.archive(transferred.userId, {
        cardId: transferred.sber2.id,
        archivedOn: D('2024-08-20'),
        reason: 'TRANSFERRED',
        targetCardId: transferred.sber1.id,
      }),
    );
    const dashT = await transferred.app.dashboard.getDashboard(transferred.userId, D('2024-08-20'));

    const withdrawn = await seedPair('51102', db.pool);
    unwrap(
      await withdrawn.app.archive.archive(withdrawn.userId, {
        cardId: withdrawn.sber2.id,
        archivedOn: D('2024-08-20'),
        reason: 'WITHDRAWN',
      }),
    );
    const dashW = await withdrawn.app.dashboard.getDashboard(withdrawn.userId, D('2024-08-20'));

    const lost = await seedPair('51103', db.pool);
    unwrap(
      await lost.app.archive.archive(lost.userId, {
        cardId: lost.sber2.id,
        archivedOn: D('2024-08-20'),
        reason: 'LOST',
      }),
    );
    const dashL = await lost.app.dashboard.getDashboard(lost.userId, D('2024-08-20'));

    const x = Money.from('20000.00');
    expect(dailyAmount(dashT).toFixed()).toBe('0.00');
    expect(dailyAmount(dashW).toFixed()).toBe('0.00');
    expect(dailyAmount(dashL).toFixed()).toBe('-20000.00');
    expect(dailyAmount(dashT).eq(dailyAmount(dashW))).toBe(true);
    expect(dailyAmount(dashW).eq(dailyAmount(dashL).plus(x))).toBe(true);

    expect(dashT.totalCapital.toFixed()).toBe('30000.00');
    expect(dashW.totalCapital.toFixed()).toBe('10000.00');
    expect(dashL.totalCapital.toFixed()).toBe('10000.00');
    expect(dashT.workingCards).toHaveLength(1);
    expect(dashT.workingCards[0]?.balance.toFixed()).toBe('30000.00');
  });

  it('при нулевом остатке вопрос о судьбе не задаётся, архив WITHDRAWN', async () => {
    const app = createTestApp(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '51104'));
    const card = unwrap(
      await app.card.create(userId, {
        name: 'Пустой',
        amount: Money.zero(),
        icon: null,
        createdOn: D('2024-08-20'),
      }),
    );
    const preview = await app.archive.preview(userId, card.id, D('2024-08-20'));
    expect(preview.needsDisposition).toBe(false);
    expect(preview.remainder.isZero()).toBe(true);

    unwrap(
      await app.archive.archive(userId, {
        cardId: card.id,
        archivedOn: D('2024-08-20'),
        reason: 'LOST',
      }),
    );
    const archived = await app.card.listArchived(userId);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.archiveReason).toBe('WITHDRAWN');
  });

  it('перевод остатка — в одной транзакции: ошибка получателя не архивирует источник', async () => {
    const { app, userId, sber2 } = await seedPair('51105', db.pool);
    await expect(
      app.archive.archive(userId, {
        cardId: sber2.id,
        archivedOn: D('2024-08-20'),
        reason: 'TRANSFERRED',
        targetCardId: sber2.id,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const still = await app.card.getUserCard(userId, sber2.id);
    expect(still?.archivedOn).toBeNull();
    const dash = await app.dashboard.getDashboard(userId, D('2024-08-20'));
    expect(dash.workingCards).toHaveLength(2);
    expect(dash.totalCapital.toFixed()).toBe('30000.00');
  });
});
