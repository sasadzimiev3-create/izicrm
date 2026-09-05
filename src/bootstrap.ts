import { createAppServices } from './application/services/create-services.js';
import { createClock } from './config/clock.js';
import type { DataAccess } from './infrastructure/db/data-access.js';
import type { TelegramDeps, WebCabinet } from './interface/telegram/deps.js';
import {
  createReportRateLimiter,
  stubReportService,
  type ReportService,
} from './interface/telegram/handlers/report.js';
import { createSafeLogger, type AppLogger } from './interface/telegram/log.js';

/**
 * Сборка зависимостей Telegram-слоя.
 * `ReportService.build(userId, today) → Buffer` — подпись этапа 7.
 */
export function createTelegramDeps(
  access: DataAccess,
  opts: {
    report?: ReportService;
    nowFn?: () => Date;
    logger?: AppLogger;
    webCabinet?: WebCabinet | null;
    adminTelegramIds?: readonly string[];
    timeZone?: string;
  } = {},
): TelegramDeps {
  return {
    services: createAppServices(access),
    uow: access.uow,
    users: access.users,
    dialogs: access.dialogs,
    cards: access.cards,
    processed: access.processed,
    clock: createClock(opts.nowFn),
    logger: opts.logger ?? createSafeLogger(),
    report: opts.report ?? stubReportService(),
    reportLimit: createReportRateLimiter(),
    webCabinet: opts.webCabinet ?? null,
    adminTelegramIds: opts.adminTelegramIds ?? [],
    timeZone: opts.timeZone ?? 'Europe/Moscow',
  };
}
