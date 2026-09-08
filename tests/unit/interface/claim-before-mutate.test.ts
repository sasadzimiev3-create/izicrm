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

describe('pending-claim апдейта', () => {
  it('после сбоя freeze повтор того же update_id снова вызывает сервис', async () => {
    const completed = new Set<string>();
    const freezeCalls: number[] = [];
    let dialogRev = 1;
    const deps = makeDeps(completed, freezeCalls, () => dialogRev, (from, to) => {
      if (dialogRev === from) {
        dialogRev = to;
      }
    }, (expected) => {
      if (expected !== dialogRev) {
        return 'stale';
      }
      dialogRev += 1;
      return dialogRev;
    });
    const data = encodeCallback('freeze', CARD.id, 1);

    const first = new MemorySender();
    await handleIncoming(
      deps,
      { kind: 'callback', updateId: 42, telegramId: USER.telegramId, data },
      first,
    );
    expect(freezeCalls).toEqual([1]);
    expect(first.allTexts()).toContain(COPY.genericError);
    expect(completed.has('42')).toBe(false);
    expect(dialogRev).toBe(1);

    const second = new MemorySender();
    await handleIncoming(
      deps,
      { kind: 'callback', updateId: 42, telegramId: USER.telegramId, data },
      second,
    );
    expect(freezeCalls).toEqual([1, 1]);
  });
});

function makeDeps(
  completed: Set<string>,
  freezeCalls: number[],
  currentRev: () => number,
  restoreRev: (from: number, to: number) => void,
  consumeRev: (expected: number) => 'missing' | 'stale' | number,
): TelegramDeps {
  const pending = new Set<string>();
  return {
    uow: {
      withUser: async (_userId, work) => work(TX),
      withTelegramIdentity: async (_telegramId, work) => work(TX),
      withOps: async (work) => work(TX),
    },
    users: {
      findOrCreateByTelegramId: async () => USER,
      getUserByTelegramId: async () => USER,
      markUserBlocked: async () => undefined,
    },
    processed: {
      claim: async (_userId, key, _tx, isPending) => {
        if (completed.has(key)) {
          return false;
        }
        if (isPending === true) {
          pending.add(key);
          return true;
        }
        if (pending.has(key) || completed.has(key)) {
          return false;
        }
        pending.add(key);
        return true;
      },
      complete: async (_userId, key) => {
        pending.delete(key);
        completed.add(key);
      },
    },
    dialogs: {
      getUserDialogState: async () => ({
        userId: USER.id,
        state: 'Idle',
        payload: {},
        businessDate: null,
        stateRev: currentRev(),
        expiresAt: new Date('2024-08-20T12:30:00+03:00'),
      }),
      consumeUserDialogRev: async (_userId, expected) => consumeRev(expected),
      restoreUserDialogRev: async (_userId, from, to) => {
        restoreRev(from, to);
      },
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
