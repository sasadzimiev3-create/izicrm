import type { ActivitySnapshot } from '../dto/activity-stats.js';
import type { UserId } from '../../domain/cards/card.js';
import type { BusinessDate } from '../../domain/finance/period.js';

import type { ServiceDeps } from './support.js';

export class ActivityService {
  constructor(private readonly deps: ServiceDeps) {}

  async recordBotDay(userId: UserId, day: BusinessDate): Promise<void> {
    await this.deps.uow.withUser(userId, (tx) => this.deps.activity.touchUserDay(userId, day, tx));
  }

  async recordWebLogin(userId: UserId, day: BusinessDate): Promise<void> {
    await this.deps.uow.withUser(userId, async (tx) => {
      await this.deps.activity.insertUserWebLogin(userId, tx);
      await this.deps.activity.touchUserDay(userId, day, tx);
    });
  }

  async snapshot(actorUserId: UserId, now: Date, timeZone: string): Promise<ActivitySnapshot> {
    return this.deps.uow.withUser(actorUserId, (tx) =>
      this.deps.activity.loadSnapshot(now, timeZone, tx),
    );
  }
}
