import { describe, expect, it } from 'vitest';

import { ConflictError } from '../../../src/domain/errors.js';
import { normalizeCardName } from '../../../src/domain/cards/card-name.js';
import { parseBusinessDate } from '../../../src/domain/finance/period.js';
import { createDataAccess } from '../../../src/infrastructure/db/data-access.js';
import { parseUserId } from '../../../src/infrastructure/db/ids.js';
import { insertUser, useAppDb, withUser } from '../harness.js';

const D = parseBusinessDate;

describe('нормализация названия совпадает с cards.name_norm', () => {
  const db = useAppDb();

  it('insert через репозиторий даёт тот же name_norm, что normalizeCardName', async () => {
    const { uow, cards } = createDataAccess(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '41401'));
    const raw = '  Сбер\t1  ';

    await uow.withUser(userId, async (tx) => {
      await cards.insertUserCard(userId, { name: raw, createdOn: D('2024-08-01'), icon: null }, tx);
    });

    const fromDb = await withUser(db.pool(), String(userId), async (client) => {
      const result = await client.query<{ name_norm: string }>(`SELECT name_norm FROM cards`);
      return result.rows[0]?.name_norm;
    });
    expect(fromDb).toBe(normalizeCardName(raw));
    expect(fromDb).toBe('сбер 1');

    await uow.withUser(userId, async (tx) => {
      const found = await cards.findActiveByNormalizedName(userId, normalizeCardName(raw), tx);
      expect(found?.name).toBe(raw);
    });
  });

  it('дубль активного названия после нормализации → ConflictError', async () => {
    const { uow, cards } = createDataAccess(db.pool());
    const userId = parseUserId(await insertUser(db.pool(), '41402'));

    await uow.withUser(userId, async (tx) => {
      await cards.insertUserCard(
        userId,
        { name: 'Сбер1', createdOn: D('2024-08-01'), icon: null },
        tx,
      );
      await expect(
        cards.insertUserCard(userId, { name: ' сбер1 ', createdOn: D('2024-08-02'), icon: null }, tx),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });
});
