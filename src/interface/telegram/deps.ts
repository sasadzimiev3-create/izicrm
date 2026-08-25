import type { AppServices } from '../../application/services/create-services.js';
import type { CardRepository } from '../../application/ports/card-repository.js';
import type { DialogStateRepository } from '../../application/ports/dialog-state-repository.js';
import type { ProcessedUpdateRepository } from '../../application/ports/processed-update-repository.js';
import type { UserRepository } from '../../application/ports/user-repository.js';
import type { UnitOfWork } from '../../application/ports/unit-of-work.js';
import type { Clock } from '../../config/clock.js';
import type { UserId } from '../../domain/cards/card.js';

import type { ReportService } from './handlers/report.js';
import type { AppLogger } from './log.js';

export type ReportRateLimiter = {
  tryAcquire(userId: UserId, now: Date): boolean;
};

export type TelegramDeps = {
  services: AppServices;
  uow: UnitOfWork;
  users: UserRepository;
  dialogs: DialogStateRepository;
  cards: CardRepository;
  processed: ProcessedUpdateRepository;
  clock: Clock;
  logger: AppLogger;
  report: ReportService;
  reportLimit: ReportRateLimiter;
};
