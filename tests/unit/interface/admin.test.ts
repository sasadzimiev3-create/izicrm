import { describe, expect, it } from 'vitest';

import type { AppServices } from '../../../src/application/services/create-services.js';
import type { ActivitySnapshot } from '../../../src/application/dto/activity-stats.js';
import type { Dashboard } from '../../../src/application/dto/dashboard.js';
import type { DbTx } from '../../../src/application/ports/unit-of-work.js';
import type { UserRecord } from '../../../src/application/ports/user-repository.js';
import { createClock } from '../../../src/config/clock.js';
import { userId } from '../../../src/domain/cards/card.js';
import { parseBusinessDate } from '../../../src/domain/finance/period.js';
import { Money } from '../../../src/domain/money/money.js';
import type { TelegramDeps } from '../../../src/interface/telegram/deps.js';
import { isAdminCommand, isAdminTelegramId } from '../../../src/interface/telegram/handlers/admin.js';
import { createSafeLogger } from '../../../src/interface/telegram/log.js';
import { MemorySender } from '../../../src/interface/telegram/protocol.js';
import { handleIncoming } from '../../../src/interface/telegram/runtime.js';
import { COPY } from '../../../src/interface/telegram/views/copy.js';

const TX = {} as DbTx;
const ADMIN: UserRecord = {
  id: userId(1),
  telegramId: '8069167166',
  tz: 'Europe/Moscow',
  languageCode: 'ru',
};

const EMPTY_DASHBOARD: Dashboard = {
  today: parseBusinessDate('2024-08-20'),
  lastUpdateDate: null,
  workingCapital: Money.zero(),
  frozenCapital: Money.zero(),
  totalCapital: Money.zero(),
  daily: { defined: false, reason: 'NO_PREVIOUS_DATA' },
  monthly: {
    amount: Money.zero(),
    percent: { defined: false, reason: 'NO_PREVIOUS_DATA' },
    openingCapital: Money.zero(),
    closingCapital: Money.zero(),
    netFlow: Money.zero(),
  },
  workingCards: [],
  frozenCards: [],
};

const SNAPSHOT: ActivitySnapshot = {
  newStartToday: '1',
  newStartWeek: '2',
  usedAfterStartToday: '0',
  usedAfterStartWeek: '1',
  streakToday: '0',
  streakWeek: '0',
  webToday: '0',
  webWeek: '0',
  registeredAll: '2',
  blockedAll: '0',
  withMaterialAll: '0',
};

describe('доступ /admin', () => {
  it('распознаёт команду и allowlist', () => {
    expect(isAdminCommand('/admin')).toBe(true);
    expect(isAdminCommand('/admin@izicrm_bot')).toBe(true);
    expect(isAdminTelegramId('8069167166', ['8069167166', '432654986'])).toBe(true);
    expect(isAdminTelegramId('1', ['8069167166'])).toBe(false);
  });

  it('чужой /admin получает домашний экран', async () => {
    const deps = makeDeps('999', []);
    const sender = new MemorySender();
    await handleIncoming(
      deps,
      { kind: 'message', updateId: 1, telegramId: '999', text: '/admin' },
      sender,
    );
    expect(sender.allTexts()).not.toContain('Активность');
    expect(sender.allTexts()).toContain(COPY.emptyOnboarding);
  });

  it('allowlist видит отчёт за день и неделю', async () => {
    const deps = makeDeps(ADMIN.telegramId, [ADMIN.telegramId]);
    const sender = new MemorySender();
    await handleIncoming(
      deps,
      { kind: 'message', updateId: 2, telegramId: ADMIN.telegramId, text: '/admin' },
      sender,
    );
    expect(sender.lastText).toContain('Впервые /start: 1');
    expect(sender.lastText).toContain('После старта: 0');
    expect(sender.lastText).toContain('7 дней');
  });
});

function makeDeps(telegramId: string, allowlist: readonly string[]): TelegramDeps {
  const user: UserRecord = { ...ADMIN, telegramId };
  const claimed = new Set<string>();
  return {
    uow: {
      withUser: async (_userId, work) => work(TX),
      withTelegramIdentity: async (_id, work) => work(TX),
    },
    users: {
      findOrCreateByTelegramId: async () => user,
      getUserByTelegramId: async () => user,
      markUserBlocked: async () => undefined,
    },
    processed: {
      claim: async (_userId, key) => {
        if (claimed.has(key)) {
          return false;
        }
        claimed.add(key);
        return true;
      },
    },
    dialogs: {
      getUserDialogState: async () => null,
      upsertUserDialogState: async (_userId, input) => ({
        userId: user.id,
        state: input.state,
        payload: input.payload,
        businessDate: input.businessDate,
        stateRev: 1,
        expiresAt: input.expiresAt,
      }),
      clearUserDialogState: async () => undefined,
    },
    cards: {} as TelegramDeps['cards'],
    services: {
      card: { getUserCard: async () => null },
      dashboard: { getDashboard: async () => EMPTY_DASHBOARD },
      activity: {
        recordBotDay: async () => undefined,
        snapshot: async () => SNAPSHOT,
      },
    } as unknown as AppServices,
    clock: createClock(() => new Date('2024-08-20T12:00:00+03:00')),
    logger: createSafeLogger(() => undefined),
    report: { build: async () => Buffer.from('') },
    reportLimit: { tryAcquire: () => true },
    webCabinet: null,
    adminTelegramIds: allowlist,
    timeZone: 'Europe/Moscow',
  };
}
