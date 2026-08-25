import { describe, expect, it } from 'vitest';

import { parseBusinessDate } from '../../../src/domain/finance/period.js';
import { Money } from '../../../src/domain/money/money.js';
import { createDataAccess } from '../../../src/infrastructure/db/data-access.js';
import { parseUserId } from '../../../src/infrastructure/db/ids.js';
import { insertUser, useAppDb } from '../harness.js';

const D = parseBusinessDate;

describe('диалог, пользователь и выгрузка истории', () => {
  const db = useAppDb();

  it('upsert диалога увеличивает state_rev; деньги в payload — строки', async () => {
    const { uow, dialogs } = createDataAccess(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '41501'));
    const expiresAt = new Date('2024-08-20T12:00:00.000Z');

    await uow.withUser(userId, async (tx) => {
      const first = await dialogs.upsertUserDialogState(
        userId,
        {
          state: 'CardCreateBalance',
          payload: { name: 'Сбер', amount: '10000.00' },
          businessDate: D('2024-08-01'),
          expiresAt,
        },
        tx,
      );
      expect(first.stateRev).toBe(1);
      expect(first.payload['amount']).toBe('10000.00');
      expect(typeof first.payload['amount']).toBe('string');

      const second = await dialogs.upsertUserDialogState(
        userId,
        {
          state: 'Idle',
          payload: {},
          businessDate: null,
          expiresAt,
        },
        tx,
      );
      expect(second.stateRev).toBe(2);
      expect(second.state).toBe('Idle');

      await dialogs.clearUserDialogState(userId, tx);
      const cleared = await dialogs.getUserDialogState(userId, tx);
      expect(cleared?.state).toBe('Idle');
      expect(cleared?.stateRev).toBe(3);
    });
  });

  it('withTelegramIdentity создаёт пользователя идемпотентно', async () => {
    const { uow, users } = createDataAccess(db.pool());

    const first = await uow.withTelegramIdentity('41502', (tx) =>
      users.findOrCreateByTelegramId('41502', tx),
    );
    const second = await uow.withTelegramIdentity('41502', (tx) =>
      users.findOrCreateByTelegramId('41502', tx),
    );
    expect(second.id).toBe(first.id);
    expect(first.telegramId).toBe('41502');
  });

  it('report-query отдаёт строки без суммирования', async () => {
    const { uow, cards, balances, reports } = createDataAccess(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '41503'));

    await uow.withUser(userId, async (tx) => {
      const card = await cards.insertUserCard(
        userId,
        { name: 'Отчёт', createdOn: D('2024-08-01'), icon: '💳' },
        tx,
      );
      await balances.insertSuperseding(
        userId,
        {
          cardId: card.id,
          effectiveDate: D('2024-08-01'),
          amount: Money.from('10.00'),
          capitalIn: Money.from('10.00'),
          capitalOut: Money.zero(),
          source: 'CARD_CREATED',
        },
        tx,
      );
      await balances.insertSuperseding(
        userId,
        {
          cardId: card.id,
          effectiveDate: D('2024-08-02'),
          amount: Money.from('12.00'),
          capitalIn: Money.zero(),
          capitalOut: Money.zero(),
          source: 'DAILY_UPDATE',
        },
        tx,
      );

      const history = await reports.loadUserHistory(userId, D('2024-08-01'), D('2024-08-31'), tx);
      expect(history.cards).toHaveLength(1);
      expect(history.cards[0]?.icon).toBe('💳');
      expect(history.entries).toHaveLength(2);
      expect(history.entries.map((entry) => entry.amount.toFixed())).toEqual(['10.00', '12.00']);
      expect(history.flows).toHaveLength(1);
      expect(history.flows[0]?.amount.toFixed()).toBe('10.00');
    });
  });
});
