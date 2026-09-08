import {
  DEFAULT_NOTIFY_MINUTE,
  toggleDay,
  wrapMinute,
  type ReminderSettings,
} from '../dto/reminder.js';
import type { UserId } from '../../domain/cards/card.js';
import { ValidationError } from '../../domain/errors.js';

import type { ServiceDeps } from './support.js';

const DEFAULT_REMINDER: ReminderSettings = {
  enabled: false,
  notifyMinute: DEFAULT_NOTIFY_MINUTE,
  days: 0,
};

export class ReminderService {
  constructor(private readonly deps: ServiceDeps) {}

  async getUserReminder(userId: UserId): Promise<ReminderSettings> {
    return this.deps.uow.withUser(userId, async (tx) => {
      const existing = await this.deps.reminders.getUserReminder(userId, tx);
      if (existing !== null) {
        return existing;
      }
      await this.deps.reminders.upsertUserReminder(userId, DEFAULT_REMINDER, tx);
      return DEFAULT_REMINDER;
    });
  }

  async saveUserReminder(userId: UserId, settings: ReminderSettings): Promise<ReminderSettings> {
    const next: ReminderSettings = {
      enabled: settings.enabled && settings.days !== 0,
      notifyMinute: wrapMinute(settings.notifyMinute),
      days: settings.days & 127,
    };
    if (settings.enabled && next.days === 0) {
      throw new ValidationError('Выберите хотя бы один день');
    }
    await this.deps.uow.withUser(userId, (tx) =>
      this.deps.reminders.upsertUserReminder(userId, next, tx),
    );
    return next;
  }

  async toggleUserDay(userId: UserId, bit: number): Promise<ReminderSettings> {
    const current = await this.getUserReminder(userId);
    const days = toggleDay(current.days, bit);
    return this.saveUserReminder(userId, {
      ...current,
      days,
      enabled: current.enabled && days !== 0,
    });
  }

  async addUserMinutes(userId: UserId, delta: number): Promise<ReminderSettings> {
    const current = await this.getUserReminder(userId);
    return this.saveUserReminder(userId, {
      ...current,
      notifyMinute: wrapMinute(current.notifyMinute + delta),
    });
  }

  async setUserEnabled(userId: UserId, enabled: boolean): Promise<ReminderSettings> {
    const current = await this.getUserReminder(userId);
    return this.saveUserReminder(userId, { ...current, enabled });
  }

  async submitUserFeedback(userId: UserId, message: string): Promise<void> {
    const trimmed = message.trim();
    if (trimmed.length < 1 || trimmed.length > 2000) {
      throw new ValidationError('Напишите сообщение до 2000 символов');
    }
    await this.deps.uow.withUser(userId, (tx) =>
      this.deps.reminders.insertUserFeedback(userId, trimmed, tx),
    );
  }

  async claimDueTelegramIds(now: Date): Promise<string[]> {
    return this.deps.uow.withOps((tx) => this.deps.reminders.claimDueReminders(now, tx));
  }

  async releaseDueTelegramId(telegramId: string): Promise<void> {
    await this.deps.uow.withOps((tx) => this.deps.reminders.releaseDueReminder(telegramId, tx));
  }
}
