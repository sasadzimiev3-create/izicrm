import { GrammyError, type Bot } from 'grammy';

import type { AppServices } from '../../application/services/create-services.js';
import type { UserRepository } from '../../application/ports/user-repository.js';
import type { UnitOfWork } from '../../application/ports/unit-of-work.js';
import type { Clock } from '../../config/clock.js';
import type { AppLogger } from './log.js';

export const REMINDER_TICK_MS = 20_000;

export type ReminderLoop = {
  stop(): void;
};

/**
 * Раз в ~20 с забирает просроченные напоминания (окно 10 минут) и пишет в Telegram.
 */
export function startReminderLoop(
  bot: Bot,
  deps: {
    services: AppServices;
    uow: UnitOfWork;
    users: UserRepository;
    clock: Clock;
    logger: AppLogger;
    gate: {
      isAccepting(): boolean;
      run<T>(work: () => Promise<T>): Promise<T>;
    };
    text: string;
  },
): ReminderLoop {
  let stopped = false;

  const tick = (): void => {
    if (stopped || !deps.gate.isAccepting()) {
      return;
    }
    void deps.gate
      .run(async () => {
        const ids = await deps.services.reminder.claimDueTelegramIds(deps.clock.now());
        for (const telegramId of ids) {
          try {
            await bot.api.sendMessage(telegramId, deps.text);
          } catch (error) {
            if (error instanceof GrammyError && error.error_code === 403) {
              await deps.uow.withTelegramIdentity(telegramId, (tx) =>
                deps.users.markUserBlocked(telegramId, tx),
              );
              continue;
            }
            deps.logger.error(
              { userId: 0, correlationId: 'remind', err: String(error) },
              'reminder send failed',
            );
            try {
              await deps.services.reminder.releaseDueTelegramId(telegramId);
            } catch (releaseError: unknown) {
              deps.logger.error(
                { userId: 0, correlationId: 'remind', err: String(releaseError) },
                'reminder release failed',
              );
            }
          }
        }
      })
      .catch((error: unknown) => {
        deps.logger.error(
          { userId: 0, correlationId: 'remind', err: String(error) },
          'reminder tick failed',
        );
      });
  };

  const timer = setInterval(tick, REMINDER_TICK_MS);
  tick();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
