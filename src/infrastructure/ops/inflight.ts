import type { UnitOfWork } from '../../application/ports/unit-of-work.js';

export class ShutdownInProgressError extends Error {
  constructor() {
    super('shutdown in progress: new work is not accepted');
    this.name = 'ShutdownInProgressError';
  }
}

/**
 * Счётчик незавершённой работы. На SIGTERM бот перестаёт принимать апдейты,
 * текущие транзакции дожимаются, затем закрывается пул.
 *
 * @see docs/architecture.md §7
 */
export type InFlightGate = {
  run<T>(work: () => Promise<T>): Promise<T>;
  stopAccepting(): void;
  drain(timeoutMs: number): Promise<void>;
  activeCount(): number;
  isAccepting(): boolean;
};

export function createInFlightGate(): InFlightGate {
  let accepting = true;
  let active = 0;
  const waiters: Array<() => void> = [];

  function notifyIdle(): void {
    if (active !== 0) {
      return;
    }
    while (waiters.length > 0) {
      waiters.pop()?.();
    }
  }

  return {
    isAccepting() {
      return accepting;
    },
    activeCount() {
      return active;
    },
    stopAccepting() {
      accepting = false;
      notifyIdle();
    },
    async run<T>(work: () => Promise<T>): Promise<T> {
      if (!accepting) {
        throw new ShutdownInProgressError();
      }
      active += 1;
      try {
        return await work();
      } finally {
        active -= 1;
        notifyIdle();
      }
    },
    async drain(timeoutMs: number): Promise<void> {
      if (active === 0) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`in-flight work did not finish within ${String(timeoutMs)}ms`));
        }, timeoutMs);
        waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

/**
 * Обёртка Unit of Work: новые транзакции после stopAccepting не открываются.
 */
export function trackUnitOfWork(uow: UnitOfWork, gate: InFlightGate): UnitOfWork {
  return {
    withUser(userId, work) {
      return gate.run(() => uow.withUser(userId, work));
    },
    withTelegramIdentity(telegramId, work) {
      return gate.run(() => uow.withTelegramIdentity(telegramId, work));
    },
  };
}
