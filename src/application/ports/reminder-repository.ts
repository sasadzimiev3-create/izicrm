import type { ReminderSettings } from '../dto/reminder.js';
import type { UserId } from '../../domain/cards/card.js';

import type { DbTx } from './unit-of-work.js';

export interface ReminderRepository {
  getUserReminder(userId: UserId, tx: DbTx): Promise<ReminderSettings | null>;
  upsertUserReminder(userId: UserId, settings: ReminderSettings, tx: DbTx): Promise<void>;
  insertUserFeedback(userId: UserId, message: string, tx: DbTx): Promise<void>;
  claimDueReminders(now: Date, tx: DbTx): Promise<string[]>;
}
