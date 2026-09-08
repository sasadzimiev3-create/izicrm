import { sql } from 'kysely';

import type { ReminderSettings } from '../../application/dto/reminder.js';
import type { ReminderRepository } from '../../application/ports/reminder-repository.js';
import type { DbTx } from '../../application/ports/unit-of-work.js';
import type { UserId } from '../../domain/cards/card.js';
import { userIdParam } from '../db/ids.js';
import { kyselyTx } from '../db/tx.js';

function toSettings(row: {
  enabled: boolean;
  notify_minute: number | string;
  days: number | string;
}): ReminderSettings {
  return {
    enabled: row.enabled,
    notifyMinute: Number(row.notify_minute),
    days: Number(row.days),
  };
}

export class PgReminderRepository implements ReminderRepository {
  async getUserReminder(userId: UserId, tx: DbTx): Promise<ReminderSettings | null> {
    const row = await kyselyTx(tx)
      .selectFrom('reminders')
      .select(['enabled', 'notify_minute', 'days'])
      .where('user_id', '=', userIdParam(userId))
      .executeTakeFirst();
    return row === undefined ? null : toSettings(row);
  }

  async upsertUserReminder(userId: UserId, settings: ReminderSettings, tx: DbTx): Promise<void> {
    await kyselyTx(tx)
      .insertInto('reminders')
      .values({
        user_id: userIdParam(userId),
        enabled: settings.enabled,
        notify_minute: settings.notifyMinute,
        days: settings.days,
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column('user_id').doUpdateSet({
          enabled: settings.enabled,
          notify_minute: settings.notifyMinute,
          days: settings.days,
          updated_at: new Date(),
        }),
      )
      .execute();
  }

  async insertUserFeedback(userId: UserId, message: string, tx: DbTx): Promise<void> {
    await kyselyTx(tx)
      .insertInto('user_feedback')
      .values({ user_id: userIdParam(userId), message })
      .execute();
  }

  async claimDueReminders(now: Date, tx: DbTx): Promise<string[]> {
    const result = await sql<{ telegram_id: string }>`
      SELECT telegram_id FROM ops_claim_due_reminders(${now})
    `.execute(kyselyTx(tx));
    return result.rows.map((row) => row.telegram_id);
  }

  async releaseDueReminder(telegramId: string, tx: DbTx): Promise<void> {
    await sql`
      SELECT ops_release_due_reminder(${telegramId})
    `.execute(kyselyTx(tx));
  }
}
