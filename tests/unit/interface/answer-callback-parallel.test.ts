import { describe, expect, it } from 'vitest';

import type { AppServices } from '../../../src/application/services/create-services.js';
import type { DbTx } from '../../../src/application/ports/unit-of-work.js';
import type { UserRecord } from '../../../src/application/ports/user-repository.js';
import { createClock } from '../../../src/config/clock.js';
import { userId } from '../../../src/domain/cards/card.js';
import type { TelegramDeps } from '../../../src/interface/telegram/deps.js';
import { createSafeLogger } from '../../../src/interface/telegram/log.js';
import { MemorySender, type TelegramSender } from '../../../src/interface/telegram/protocol.js';
import { handleIncoming } from '../../../src/interface/telegram/runtime.js';
import { encodeCallback } from '../../../src/interface/telegram/keyboards/callback-data.js';
import { COPY } from '../../../src/interface/telegram/views/copy.js';

const TX = {} as DbTx;
const USER: UserRecord = {
  id: userId(1),
  telegramId: '90002',
  tz: 'Europe/Moscow',
  languageCode: 'ru',
};

function settingsUpdate(updateId: number) {
  return {
    kind: 'callback' as const,
    updateId,
    telegramId: USER.telegramId,
    data: encodeCallback('settings', null, 0),
  };
}

function makeDeps(): TelegramDeps {
  const claimed = new Set<string>();
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
    cards: {} as TelegramDeps['cards'],
    services: {
      card: { getUserCard: async () => null },
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

describe('answerCallback параллельно с отрисовкой', () => {
  it('экран уходит, не дожидаясь завершения answerCallback', async () => {
    const inner = new MemorySender();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const sender: TelegramSender = {
      sendMessage: async (text, keyboard, parseMode) => {
        order.push('send');
        await inner.sendMessage(text, keyboard, parseMode);
      },
      sendDocument: async (file, filename) => inner.sendDocument(file, filename),
      answerCallback: async (text) => {
        order.push('ack-start');
        await gate;
        await inner.answerCallback(text);
        order.push('ack-end');
      },
    };

    const done = handleIncoming(makeDeps(), settingsUpdate(1), sender);
    await expect.poll(() => order.slice()).toEqual(['ack-start', 'send']);
    expect(inner.lastText).toBe(COPY.settingsTitle);
    expect(inner.callbackAnswers).toHaveLength(0);

    release();
    await done;
    expect(order).toEqual(['ack-start', 'send', 'ack-end']);
    expect(inner.callbackAnswers).toHaveLength(1);
  });

  it('сбой answerCallback не блокирует экран', async () => {
    const inner = new MemorySender();
    const sender: TelegramSender = {
      sendMessage: async (text, keyboard, parseMode) => inner.sendMessage(text, keyboard, parseMode),
      sendDocument: async (file, filename) => inner.sendDocument(file, filename),
      answerCallback: async () => {
        throw new Error('proxy down');
      },
    };

    await handleIncoming(makeDeps(), settingsUpdate(2), sender);
    expect(inner.lastText).toBe(COPY.settingsTitle);
  });
});
