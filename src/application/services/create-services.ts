import { ArchiveService } from './archive.service.js';
import { BalanceUpdateService } from './balance-update.service.js';
import { CardService } from './card.service.js';
import { DashboardService } from './dashboard.service.js';
import { FreezeService } from './freeze.service.js';
import { SpendService } from './spend.service.js';
import { TopUpService } from './topup.service.js';
import type { ServiceDeps } from './support.js';

export type AppServices = {
  dashboard: DashboardService;
  card: CardService;
  balanceUpdate: BalanceUpdateService;
  topup: TopUpService;
  freeze: FreezeService;
  spend: SpendService;
  archive: ArchiveService;
};

export function createAppServices(deps: ServiceDeps): AppServices {
  return {
    dashboard: new DashboardService(deps),
    card: new CardService(deps),
    balanceUpdate: new BalanceUpdateService(deps),
    topup: new TopUpService(deps),
    freeze: new FreezeService(deps),
    spend: new SpendService(deps),
    archive: new ArchiveService(deps),
  };
}

export type { ServiceDeps };
