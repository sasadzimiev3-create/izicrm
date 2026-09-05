import { describe, expect, it } from 'vitest';

import type { AppServices } from '../../../src/application/services/create-services.js';
import type { CardRow } from '../../../src/application/ports/card-repository.js';
import type { DbTx } from '../../../src/application/ports/unit-of-work.js';
import type { UserRecord } from '../../../src/application/ports/user-repository.js';
import { createClock } from '../../../src/config/clock.js';
import { cardId, userId } from '../../../src/domain/cards/card.js';
import { parseBusinessDate } from '../../../src/domain/finance/period.js';
import type { TelegramDeps } from '../../../src/interface/telegram/deps.js';
import { createSafeLogger } from '../../../src/interface/telegram/log.js';
import { MemorySender } from '../../../src/interface/telegram/protocol.js';
import { handleIncoming } from '../../../src/interface/telegram/runtime.js';
import { encodeCallback } from '../../../src/interface/telegram/keyboards/callback-data.js';
import { COPY } from '../../../src/interface/telegram/views/copy.js';

const TX = {} as DbTx;
const USER: UserRecord = {
  id: userId(1),
  telegramId: '90001',
  tz: 'Europe/Moscow',
  languageCode: 'ru',
};
const CARD: CardRow = {
  id: cardId(7),
  userId: USER.id,
  name: 'Альфа',
  createdOn: parseBusinessDate('2024-08-01'),
  frozenOn: null,
  archivedOn: null,
  archiveReason: null,
  icon: null,
};

describe('claim до мутации', () => {
  it('после сбоя freeze повтор того же update_id не вызывает сервис', async () => {
    const claimed = new Set<string>();
    const freezeCalls: number[] = [];
    const deps = makeDeps(claimed, freezeCalls);
    const data = encodeCallback('freeze', CARD.id, 0);

    const first = new MemorySender();
    await handleIncoming(
      deps,
      { kind: 'callback', updateId: 42, telegramId: USER.telegramId, data },
      first,
    );
    expect(freezeCalls).toEqual([1]);
    expect(first.allTexts()).toContain(COPY.genericError);
    expect(claimed.has('42')).toBe(true);

    const second = new MemorySender();
    await handleIncoming(
      deps,
      { kind: 'callback', updateId: 42, telegramId: USER.telegramId, data },
      second,
    );
    expect(freezeCalls).toEqual([1]);
    expect(second.messages).toHaveLength(0);
  });
});

function makeDeps(claimed: Set<string>, freezeCalls: number[]): TelegramDeps {
  return {
    uow: {
      withUser: async (_userId, work) => work(TX),
      withTelegramIdentity: async (_telegramId, work) => work(TX),
    },
    users: {
      findOrCreateByTelegramId: async () => USER,
      getUserByTelegramId: async () => USER,
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
        userId: USER.id,
        state: input.state,
        payload: input.payload,
        businessDate: input.businessDate,
        stateRev: 1,
        expiresAt: input.expiresAt,
      }),
      clearUserDialogState: async () => undefined,
    },
    cards: {
      getUserCard: async () => CARD,
    } as unknown as TelegramDeps['cards'],
    services: {
      card: { getUserCard: async () => CARD },
      freeze: {
        freeze: async () => {
          freezeCalls.push(1);
          throw new Error('db down');
        },
      },
      activity: { recordBotDay: async () => undefined },
    } as unknown as AppServices,
    clock: createClock(() => new Date('2024-08-20T12:00:00+03:00')),
    logger: createSafeLogger(() => undefined),
    report: { build: async () => Buffer.from('') },
    reportLimit: { tryAcquire: () => true },
    webCabinet: null,
    adminTelegramIds: [],
    timeZone: 'Europe/Moscow',
  };
}
