import type pg from 'pg';

import type { ActivityRepository } from '../../application/ports/activity-repository.js';
import type { AuditLogRepository } from '../../application/ports/audit-log-repository.js';
import type { BalanceRepository } from '../../application/ports/balance-repository.js';
import type { CardRepository } from '../../application/ports/card-repository.js';
import type { DialogStateRepository } from '../../application/ports/dialog-state-repository.js';
import type { ProcessedUpdateRepository } from '../../application/ports/processed-update-repository.js';
import type { ReportQueryRepository } from '../../application/ports/report-query-repository.js';
import type { UnitOfWork } from '../../application/ports/unit-of-work.js';
import type { UserRepository } from '../../application/ports/user-repository.js';

import { createKysely } from './kysely.js';
import { PgUnitOfWork } from './unit-of-work.js';
import { PgActivityRepository } from '../repositories/activity.repository.js';
import { PgAuditLogRepository } from '../repositories/audit-log.repository.js';
import { PgBalanceRepository } from '../repositories/balance.repository.js';
import { PgCardRepository } from '../repositories/card.repository.js';
import { PgDialogStateRepository } from '../repositories/dialog-state.repository.js';
import { PgProcessedUpdateRepository } from '../repositories/processed-update.repository.js';
import { PgReportQueryRepository } from '../repositories/report-query.repository.js';
import { PgUserRepository } from '../repositories/user.repository.js';

export type DataAccess = {
  uow: UnitOfWork;
  users: UserRepository;
  cards: CardRepository;
  balances: BalanceRepository;
  dialogs: DialogStateRepository;
  reports: ReportQueryRepository;
  processed: ProcessedUpdateRepository;
  audit: AuditLogRepository;
  activity: ActivityRepository;
};

export function createDataAccess(pool: pg.Pool): DataAccess {
  const db = createKysely(pool);
  return {
    uow: new PgUnitOfWork(db),
    users: new PgUserRepository(),
    cards: new PgCardRepository(),
    balances: new PgBalanceRepository(),
    dialogs: new PgDialogStateRepository(),
    reports: new PgReportQueryRepository(),
    processed: new PgProcessedUpdateRepository(),
    audit: new PgAuditLogRepository(),
    activity: new PgActivityRepository(),
  };
}
