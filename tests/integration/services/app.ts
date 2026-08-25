import type pg from 'pg';

import { createAppServices, type AppServices } from '../../../src/application/services/create-services.js';
import type { Applied } from '../../../src/application/dto/commands.js';
import { createDataAccess } from '../../../src/infrastructure/db/data-access.js';
import type { ReportQueryRepository } from '../../../src/application/ports/report-query-repository.js';
import type { UnitOfWork } from '../../../src/application/ports/unit-of-work.js';

export type TestApp = AppServices & {
  uow: UnitOfWork;
  reports: ReportQueryRepository;
};

export function createTestApp(pool: pg.Pool): TestApp {
  const access = createDataAccess(pool);
  return {
    ...createAppServices(access),
    uow: access.uow,
    reports: access.reports,
  };
}

export function unwrap<T>(result: Applied<T>): T {
  if (!result.applied) {
    throw new Error('expected the operation to apply');
  }
  return result.value;
}
