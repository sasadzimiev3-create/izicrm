import { sql } from 'kysely';

import type { ActivitySnapshot } from '../../application/dto/activity-stats.js';
import type { ActivityRepository } from '../../application/ports/activity-repository.js';
import type { DbTx } from '../../application/ports/unit-of-work.js';
import type { UserId } from '../../domain/cards/card.js';
import type { BusinessDate } from '../../domain/finance/period.js';
import { userIdParam } from '../db/ids.js';
import { kyselyTx } from '../db/tx.js';

import { parseActivitySnapshot } from './activity-snapshot.js';

export class PgActivityRepository implements ActivityRepository {
  async touchUserDay(userId: UserId, day: BusinessDate, tx: DbTx): Promise<void> {
    await kyselyTx(tx)
      .insertInto('user_activity_days')
      .values({ user_id: userIdParam(userId), activity_on: day })
      .onConflict((oc) => oc.columns(['user_id', 'activity_on']).doNothing())
      .execute();
  }

  async insertUserWebLogin(userId: UserId, tx: DbTx): Promise<void> {
    await kyselyTx(tx)
      .insertInto('web_logins')
      .values({ user_id: userIdParam(userId) })
      .execute();
  }

  async loadSnapshot(now: Date, timeZone: string, tx: DbTx): Promise<ActivitySnapshot> {
    const result = await sql<{ snapshot: unknown }>`
      SELECT ops_activity_snapshot(${now}, ${timeZone}) AS snapshot
    `.execute(kyselyTx(tx));
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('ops_activity_snapshot returned no row');
    }
    return parseActivitySnapshot(row.snapshot);
  }
}
