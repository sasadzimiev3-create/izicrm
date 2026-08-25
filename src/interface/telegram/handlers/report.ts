import type { UserId } from '../../../domain/cards/card.js';
import type { BusinessDate } from '../../../domain/finance/period.js';
import { ValidationError } from '../../../domain/errors.js';

/**
 * Подпись этапа 7: `ReportService.build(userId, today) → Buffer`.
 * Этап 6 вызывает её; реализация файла — этап 7.
 *
 * @see docs/architecture.md §5.3
 */
export type ReportService = {
  build(userId: UserId, today: BusinessDate): Promise<Buffer>;
};

export function stubReportService(): ReportService {
  return {
    async build() {
      throw new ValidationError('Отчёт пока недоступен');
    },
  };
}

export function createReportRateLimiter(): { tryAcquire(userId: UserId, now: Date): boolean } {
  const last = new Map<number, number>();
  return {
    tryAcquire(userId, now) {
      const prev = last.get(userId);
      const at = now.getTime();
      if (prev !== undefined && at - prev < 60_000) {
        return false;
      }
      last.set(userId, at);
      return true;
    },
  };
}
