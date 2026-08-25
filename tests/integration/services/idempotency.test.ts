import { describe, expect, it } from 'vitest';

import { parseBusinessDate } from '../../../src/domain/finance/period.js';
import { Money } from '../../../src/domain/money/money.js';
import { insertUser, useAppDb, withUser } from '../harness.js';
import { parseUserId } from '../../../src/infrastructure/db/ids.js';

import { createTestApp, unwrap } from './app.js';

const D = parseBusinessDate;

describe('идемпотентность (ADR-009)', () => {
  const db = useAppDb();

  it('повторный вызов с тем же ключом не создаёт вторую запись', async () => {
    const app = createTestApp(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '51301'));
    const first = await app.card.create(userId, {
      name: 'Один',
      amount: Money.from('100.00'),
      icon: null,
      createdOn: D('2024-08-20'),
      idempotencyKey: '9000000000000000001',
    });
    const second = await app.card.create(userId, {
      name: 'Два',
      amount: Money.from('200.00'),
      icon: null,
      createdOn: D('2024-08-20'),
      idempotencyKey: '9000000000000000001',
    });
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);

    const dash = await app.dashboard.getDashboard(userId, D('2024-08-20'));
    expect(dash.workingCards).toHaveLength(1);
    expect(dash.totalCapital.toFixed()).toBe('100.00');

    const created = unwrap(first);
    unwrap(
      await app.balanceUpdate.update(userId, {
        cardId: created.id,
        amount: Money.from('150.00'),
        businessDate: D('2024-08-20'),
        idempotencyKey: '9000000000000000002',
      }),
    );
    const replay = await app.balanceUpdate.update(userId, {
      cardId: created.id,
      amount: Money.from('999.00'),
      businessDate: D('2024-08-20'),
      idempotencyKey: '9000000000000000002',
    });
    expect(replay.applied).toBe(false);

    const after = await app.dashboard.getDashboard(userId, D('2024-08-20'));
    expect(after.totalCapital.toFixed()).toBe('150.00');

    const rows = await withUser(db.pool(), String(userId), async (client) => {
      const result = await client.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM balance_entries WHERE user_id = $1',
        [String(userId)],
      );
      return result.rows[0]?.n;
    });
    expect(rows).toBe('2');
  });
});
