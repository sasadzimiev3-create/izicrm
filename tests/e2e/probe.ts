import type pg from 'pg';

import { createTelegramDeps } from '../../src/bootstrap.js';
import { createDataAccess } from '../../src/infrastructure/db/data-access.js';
import type { TelegramDeps } from '../../src/interface/telegram/deps.js';
import { handleIncoming } from '../../src/interface/telegram/runtime.js';
import { MemorySender } from '../../src/interface/telegram/protocol.js';
import { createSafeLogger } from '../../src/interface/telegram/log.js';

let nextUpdateId = 1;

export function findButton(sender: MemorySender, label: string): string {
  for (const message of sender.messages) {
    for (const row of message.keyboard ?? []) {
      for (const button of row) {
        if ('data' in button && button.text.includes(label)) {
          return button.data;
        }
      }
    }
  }
  throw new Error(`button «${label}» not found in: ${sender.allTexts()}`);
}

export class TelegramProbe {
  last = new MemorySender();
  updateId = 1;
  readonly logs: string[] = [];
  readonly deps: TelegramDeps;

  constructor(
    pool: pg.Pool,
    readonly telegramId: string,
    nowFn: () => Date = () => new Date('2024-08-20T12:00:00+03:00'),
    adminTelegramIds: readonly string[] = [],
  ) {
    this.updateId = nextUpdateId;
    nextUpdateId += 10_000;
    const access = createDataAccess(pool);
    this.deps = createTelegramDeps(access, {
      nowFn,
      logger: createSafeLogger((line) => this.logs.push(line)),
      adminTelegramIds,
    });
  }

  async send(text: string, updateId?: number): Promise<MemorySender> {
    const sender = new MemorySender();
    const id = updateId ?? this.updateId;
    if (updateId === undefined) {
      this.updateId += 1;
    }
    await handleIncoming(
      this.deps,
      { kind: 'message', updateId: id, telegramId: this.telegramId, text },
      sender,
    );
    this.last = sender;
    return sender;
  }

  async tap(data: string, updateId?: number): Promise<MemorySender> {
    const sender = new MemorySender();
    const id = updateId ?? this.updateId;
    if (updateId === undefined) {
      this.updateId += 1;
    }
    await handleIncoming(
      this.deps,
      { kind: 'callback', updateId: id, telegramId: this.telegramId, data },
      sender,
    );
    this.last = sender;
    return sender;
  }

  async tapLabel(label: string): Promise<MemorySender> {
    return this.tap(findButton(this.last, label));
  }
}
