import type { ActivitySnapshot } from '../dto/activity-stats.js';
import type { UserId } from '../../domain/cards/card.js';
import type { BusinessDate } from '../../domain/finance/period.js';

import type { DbTx } from './unit-of-work.js';

export interface ActivityRepository {
  touchUserDay(userId: UserId, day: BusinessDate, tx: DbTx): Promise<void>;
  insertUserWebLogin(userId: UserId, tx: DbTx): Promise<void>;
  loadSnapshot(now: Date, timeZone: string, tx: DbTx): Promise<ActivitySnapshot>;
}
