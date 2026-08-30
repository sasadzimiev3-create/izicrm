import type pg from 'pg';

import type { HealthServer } from './health.js';
import type { InFlightGate } from './inflight.js';

export const DRAIN_TIMEOUT_MS = 25_000;

export type StoppableBot = {
  isRunning(): boolean;
  stop(): Promise<void>;
};

export type RuntimeHandles = {
  bot: StoppableBot;
  pool: pg.Pool;
  health: HealthServer;
  web?: { close(): Promise<void> };
  gate: InFlightGate;
};

/**
 * SIGTERM/SIGINT останавливают polling. `bot.start()` после этого завершается,
 * и вызывающий дожимает транзакции через `finalizeRuntime`.
 *
 * @see docs/architecture.md §7
 */
export function bindStopSignals(bot: StoppableBot, gate: InFlightGate): void {
  const stop = (): void => {
    gate.stopAccepting();
    if (bot.isRunning()) {
      void bot.stop();
      return;
    }
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

export async function finalizeRuntime(handles: RuntimeHandles): Promise<void> {
  handles.gate.stopAccepting();
  if (handles.bot.isRunning()) {
    await handles.bot.stop();
  }
  await handles.gate.drain(DRAIN_TIMEOUT_MS);
  await handles.health.close();
  if (handles.web !== undefined) {
    await handles.web.close();
  }
  await handles.pool.end();
}
