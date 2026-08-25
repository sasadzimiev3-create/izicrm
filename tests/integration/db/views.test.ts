import { describe, expect, it } from 'vitest';

import {
  archiveCard,
  freezeCard,
  insertBalance,
  insertCard,
  insertUser,
  useAppDb,
  withUser,
} from '../harness.js';

type FlowRow = {
  card_id: string;
  flow_date: string;
  kind: 'DEPOSIT' | 'WITHDRAWAL';
  amount: string;
};

describe('представления', () => {
  const db = useAppDb();

  it('DB-10: оба VIEW созданы с security_invoker', async () => {
    const options = await db.pool().query<{ relname: string; reloptions: string[] | null }>(
      `SELECT c.relname, c.reloptions
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname IN ('v_capital_flows', 'v_current_balance_entries')
       ORDER BY c.relname`,
    );

    expect(options.rows).toHaveLength(2);
    for (const view of options.rows) {
      expect(view.reloptions ?? []).toContain('security_invoker=true');
    }
  });

  it('DB-14 / DB-17: v_capital_flows совпадает с §4, включая LOST, пополнение и заморозку', async () => {
    const userId = await insertUser(db.pool(), '1400');

    const deposit = await insertCard(db.pool(), userId, 'Депозит', '2024-08-01');
    await insertBalance(db.pool(), {
      userId,
      cardId: deposit,
      effectiveDate: '2024-08-01',
      amount: '10000.00',
      capitalIn: '10000.00',
    });

    const zero = await insertCard(db.pool(), userId, 'Ноль', '2024-08-01');
    await insertBalance(db.pool(), {
      userId,
      cardId: zero,
      effectiveDate: '2024-08-01',
      amount: '0.00',
      capitalIn: '0.00',
    });

    const topup = await insertCard(db.pool(), userId, 'Пополнение', '2024-08-01');
    await insertBalance(db.pool(), {
      userId,
      cardId: topup,
      effectiveDate: '2024-08-15',
      amount: '130000.00',
      capitalIn: '30000.00',
      source: 'TOP_UP',
    });

    const spend = await insertCard(db.pool(), userId, 'Трата', '2024-08-01');
    await insertBalance(db.pool(), {
      userId,
      cardId: spend,
      effectiveDate: '2024-08-16',
      amount: '70000.00',
      capitalOut: '10000.00',
      source: 'SPEND',
    });

    const withdrawn = await insertCard(db.pool(), userId, 'Вывод', '2024-08-01');
    await insertBalance(db.pool(), {
      userId,
      cardId: withdrawn,
      effectiveDate: '2024-08-01',
      amount: '20000.00',
      capitalIn: '20000.00',
    });
    await archiveCard(db.pool(), userId, withdrawn, '2024-08-10', 'WITHDRAWN');

    const transferred = await insertCard(db.pool(), userId, 'Перевод', '2024-08-01');
    await insertBalance(db.pool(), {
      userId,
      cardId: transferred,
      effectiveDate: '2024-08-01',
      amount: '15000.00',
      capitalIn: '15000.00',
    });
    await archiveCard(db.pool(), userId, transferred, '2024-08-10', 'TRANSFERRED');

    const lost = await insertCard(db.pool(), userId, 'Потеря', '2024-08-01');
    await insertBalance(db.pool(), {
      userId,
      cardId: lost,
      effectiveDate: '2024-08-01',
      amount: '7000.00',
      capitalIn: '7000.00',
    });
    await archiveCard(db.pool(), userId, lost, '2024-08-10', 'LOST');

    const emptyWithdrawn = await insertCard(db.pool(), userId, 'Пустой вывод', '2024-08-01');
    await insertBalance(db.pool(), {
      userId,
      cardId: emptyWithdrawn,
      effectiveDate: '2024-08-01',
      amount: '0.00',
      capitalIn: '0.00',
    });
    await archiveCard(db.pool(), userId, emptyWithdrawn, '2024-08-10', 'WITHDRAWN');

    const frozen = await insertCard(db.pool(), userId, 'Заморозка', '2024-08-01');
    await insertBalance(db.pool(), {
      userId,
      cardId: frozen,
      effectiveDate: '2024-08-01',
      amount: '3000.00',
      capitalIn: '3000.00',
    });
    await freezeCard(db.pool(), userId, frozen, '2024-08-05');

    const typo = await insertCard(db.pool(), userId, 'Опечатка', '2024-08-01');
    const oldTypo = await insertBalance(db.pool(), {
      userId,
      cardId: typo,
      effectiveDate: '2024-08-01',
      amount: '30000.00',
      capitalIn: '30000.00',
    });
    await withUser(db.pool(), userId, async (client) => {
      await client.query(
        `UPDATE balance_entries SET superseded_at = now(), superseded_by = id WHERE id = $1`,
        [oldTypo],
      );
    });
    await insertBalance(db.pool(), {
      userId,
      cardId: typo,
      effectiveDate: '2024-08-01',
      amount: '3000.00',
      capitalIn: '3000.00',
      source: 'CORRECTION',
    });

    const flows = await withUser(db.pool(), userId, async (client) => {
      const result = await client.query<FlowRow>(
        `SELECT card_id, flow_date::text AS flow_date, kind::text AS kind, amount::text AS amount
         FROM v_capital_flows
         WHERE user_id = $1
         ORDER BY flow_date, card_id, kind, amount`,
        [userId],
      );
      return result.rows;
    });

    const byCard = new Map<string, FlowRow[]>();
    for (const flow of flows) {
      const list = byCard.get(flow.card_id) ?? [];
      list.push(flow);
      byCard.set(flow.card_id, list);
    }

    expect(byCard.get(deposit)).toEqual([
      { card_id: deposit, flow_date: '2024-08-01', kind: 'DEPOSIT', amount: '10000.00' },
    ]);
    expect(byCard.get(zero)).toBeUndefined();
    expect(byCard.get(topup)).toEqual([
      { card_id: topup, flow_date: '2024-08-15', kind: 'DEPOSIT', amount: '30000.00' },
    ]);
    expect(byCard.get(spend)).toEqual([
      { card_id: spend, flow_date: '2024-08-16', kind: 'WITHDRAWAL', amount: '10000.00' },
    ]);
    expect(byCard.get(withdrawn)).toEqual([
      { card_id: withdrawn, flow_date: '2024-08-01', kind: 'DEPOSIT', amount: '20000.00' },
      { card_id: withdrawn, flow_date: '2024-08-10', kind: 'WITHDRAWAL', amount: '20000.00' },
    ]);
    expect(byCard.get(transferred)).toEqual([
      { card_id: transferred, flow_date: '2024-08-01', kind: 'DEPOSIT', amount: '15000.00' },
    ]);
    expect(byCard.get(lost)).toEqual([
      { card_id: lost, flow_date: '2024-08-01', kind: 'DEPOSIT', amount: '7000.00' },
    ]);
    expect(byCard.get(emptyWithdrawn)).toBeUndefined();
    expect(byCard.get(frozen)).toEqual([
      { card_id: frozen, flow_date: '2024-08-01', kind: 'DEPOSIT', amount: '3000.00' },
    ]);
    expect(byCard.get(typo)).toEqual([
      { card_id: typo, flow_date: '2024-08-01', kind: 'DEPOSIT', amount: '3000.00' },
    ]);

    const kindsForLost = (byCard.get(lost) ?? []).map((row) => row.kind);
    expect(kindsForLost).not.toContain('WITHDRAWAL');
  });
});
