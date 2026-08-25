import { describe, expect, it } from 'vitest';

import { parseUserId } from '../../../src/infrastructure/db/ids.js';
import { createDataAccess } from '../../../src/infrastructure/db/data-access.js';
import { parseBusinessDate } from '../../../src/domain/finance/period.js';
import { Money } from '../../../src/domain/money/money.js';
import { insertUser, useAppDb } from '../harness.js';

const D = parseBusinessDate;

describe('DB-13 LOCF и запросы database.md §6', () => {
  const db = useAppDb();

  it('пропущенные дни берут последнюю запись; вытесненная не видна', async () => {
    const { uow, cards, balances } = createDataAccess(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '41301'));

    const card = await uow.withUser(userId, async (tx) => {
      const created = await cards.insertUserCard(
        userId,
        { name: 'Альфа', createdOn: D('2024-08-01'), icon: null },
        tx,
      );
      await balances.insertSuperseding(
        userId,
        {
          cardId: created.id,
          effectiveDate: D('2024-08-01'),
          amount: Money.from('100.00'),
          capitalIn: Money.from('100.00'),
          capitalOut: Money.zero(),
          source: 'CARD_CREATED',
        },
        tx,
      );
      await balances.insertSuperseding(
        userId,
        {
          cardId: created.id,
          effectiveDate: D('2024-08-10'),
          amount: Money.from('150.00'),
          capitalIn: Money.zero(),
          capitalOut: Money.zero(),
          source: 'DAILY_UPDATE',
        },
        tx,
      );
      return created;
    });

    await uow.withUser(userId, async (tx) => {
      const mid = await balances.locfSnapshot(userId, D('2024-08-05'), tx);
      expect(mid).toHaveLength(1);
      expect(mid[0]?.cardId).toBe(card.id);
      expect(mid[0]?.amount.toFixed()).toBe('100.00');
      expect(mid[0]?.effectiveDate).toBe('2024-08-01');

      await balances.insertSuperseding(
        userId,
        {
          cardId: card.id,
          effectiveDate: D('2024-08-01'),
          amount: Money.from('120.00'),
          capitalIn: Money.from('120.00'),
          capitalOut: Money.zero(),
          source: 'CORRECTION',
        },
        tx,
      );

      const afterFix = await balances.locfSnapshot(userId, D('2024-08-05'), tx);
      expect(afterFix).toHaveLength(1);
      expect(afterFix[0]?.amount.toFixed()).toBe('120.00');
      expect(afterFix[0]?.effectiveDate).toBe('2024-08-01');

      const onTenth = await balances.locfSnapshot(userId, D('2024-08-10'), tx);
      expect(onTenth[0]?.amount.toFixed()).toBe('150.00');
    });
  });

  it('карта вне scope (ещё не создана / уже архивирована) не попадает в снимок', async () => {
    const { uow, cards, balances } = createDataAccess(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '41302'));

    await uow.withUser(userId, async (tx) => {
      const late = await cards.insertUserCard(
        userId,
        { name: 'Позже', createdOn: D('2024-08-08'), icon: null },
        tx,
      );
      await balances.insertSuperseding(
        userId,
        {
          cardId: late.id,
          effectiveDate: D('2024-08-08'),
          amount: Money.from('50.00'),
          capitalIn: Money.from('50.00'),
          capitalOut: Money.zero(),
          source: 'CARD_CREATED',
        },
        tx,
      );

      const archived = await cards.insertUserCard(
        userId,
        { name: 'Архив', createdOn: D('2024-08-01'), icon: null },
        tx,
      );
      await balances.insertSuperseding(
        userId,
        {
          cardId: archived.id,
          effectiveDate: D('2024-08-01'),
          amount: Money.from('70.00'),
          capitalIn: Money.from('70.00'),
          capitalOut: Money.zero(),
          source: 'CARD_CREATED',
        },
        tx,
      );
      await cards.archiveUserCard(userId, archived.id, D('2024-08-07'), 'WITHDRAWN', tx);

      const onFifth = await balances.locfSnapshot(userId, D('2024-08-05'), tx);
      expect(onFifth.map((row) => row.cardId)).toEqual([archived.id]);
      expect(onFifth[0]?.amount.toFixed()).toBe('70.00');

      const onSeventh = await balances.locfSnapshot(userId, D('2024-08-07'), tx);
      expect(onSeventh).toHaveLength(0);

      const onTenth = await balances.locfSnapshot(userId, D('2024-08-10'), tx);
      expect(onTenth).toHaveLength(1);
      expect(onTenth[0]?.cardId).toBe(late.id);
      expect(onTenth[0]?.amount.toFixed()).toBe('50.00');
    });
  });

  it('§6.2 предыдущая дата и §6.3 потоки за период', async () => {
    const { uow, cards, balances } = createDataAccess(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '41303'));

    await uow.withUser(userId, async (tx) => {
      const first = await cards.insertUserCard(
        userId,
        { name: 'Первая', createdOn: D('2024-08-01'), icon: null },
        tx,
      );
      await balances.insertSuperseding(
        userId,
        {
          cardId: first.id,
          effectiveDate: D('2024-08-01'),
          amount: Money.from('1000.00'),
          capitalIn: Money.from('1000.00'),
          capitalOut: Money.zero(),
          source: 'CARD_CREATED',
        },
        tx,
      );
      await balances.insertSuperseding(
        userId,
        {
          cardId: first.id,
          effectiveDate: D('2024-08-10'),
          amount: Money.from('1100.00'),
          capitalIn: Money.zero(),
          capitalOut: Money.zero(),
          source: 'DAILY_UPDATE',
        },
        tx,
      );

      const second = await cards.insertUserCard(
        userId,
        { name: 'Вторая', createdOn: D('2024-08-08'), icon: null },
        tx,
      );
      await balances.insertSuperseding(
        userId,
        {
          cardId: second.id,
          effectiveDate: D('2024-08-08'),
          amount: Money.from('200.00'),
          capitalIn: Money.from('200.00'),
          capitalOut: Money.zero(),
          source: 'CARD_CREATED',
        },
        tx,
      );

      const withdrawn = await cards.insertUserCard(
        userId,
        { name: 'Вывод', createdOn: D('2024-08-01'), icon: null },
        tx,
      );
      await balances.insertSuperseding(
        userId,
        {
          cardId: withdrawn.id,
          effectiveDate: D('2024-08-01'),
          amount: Money.from('30.00'),
          capitalIn: Money.from('30.00'),
          capitalOut: Money.zero(),
          source: 'CARD_CREATED',
        },
        tx,
      );
      await cards.archiveUserCard(userId, withdrawn.id, D('2024-08-09'), 'WITHDRAWN', tx);

      expect(await balances.previousUpdateDate(userId, D('2024-08-10'), tx)).toBe('2024-08-08');
      expect(await balances.previousUpdateDate(userId, D('2024-08-01'), tx)).toBeNull();

      const flows = await cards.flowsInRange(userId, D('2024-08-01'), D('2024-08-31'), tx);
      const deposits = flows.filter((flow) => flow.kind === 'DEPOSIT');
      const withdrawals = flows.filter((flow) => flow.kind === 'WITHDRAWAL');
      expect(deposits.map((flow) => flow.amount.toFixed()).sort()).toEqual(['1000.00', '200.00', '30.00']);
      expect(withdrawals).toHaveLength(1);
      expect(withdrawals[0]?.amount.toFixed()).toBe('30.00');
      expect(withdrawals[0]?.flowDate).toBe('2024-08-09');
    });
  });

  it('чужой card_id даёт null, как несуществующий', async () => {
    const { uow, cards } = createDataAccess(db.pool());
    const alice = parseUserId(await insertUser(db.pool(), '41304'));
    const bob = parseUserId(await insertUser(db.pool(), '41305'));

    const aliceCard = await uow.withUser(alice, async (tx) =>
      cards.insertUserCard(alice, { name: 'Только Алиса', createdOn: D('2024-08-01'), icon: null }, tx),
    );

    await uow.withUser(bob, async (tx) => {
      expect(await cards.getUserCard(bob, aliceCard.id, tx)).toBeNull();
      expect(await cards.listUserCards(bob, tx)).toHaveLength(0);
    });
  });
});
