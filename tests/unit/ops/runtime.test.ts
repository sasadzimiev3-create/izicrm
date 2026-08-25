import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { userId } from '../../../src/domain/cards/card.js';
import { createInFlightGate, ShutdownInProgressError, trackUnitOfWork } from '../../../src/infrastructure/ops/inflight.js';
import { expectedMigrationNames } from '../../../src/infrastructure/ops/migrations.js';
import { finalizeRuntime } from '../../../src/infrastructure/ops/shutdown.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('in-flight gate', () => {
  it('дожимает текущую работу и не принимает новую после stop', async () => {
    const gate = createInFlightGate();
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const running = gate.run(async () => {
      await blocked;
      return 1;
    });

    gate.stopAccepting();
    await expect(gate.run(async () => 2)).rejects.toBeInstanceOf(ShutdownInProgressError);

    const draining = gate.drain(1_000);
    release();
    await expect(running).resolves.toBe(1);
    await expect(draining).resolves.toBeUndefined();
    expect(gate.activeCount()).toBe(0);
  });

  it('trackUnitOfWork не открывает транзакцию после stop', async () => {
    const gate = createInFlightGate();
    gate.stopAccepting();
    const uow = trackUnitOfWork(
      {
        async withUser<T>(): Promise<T> {
          throw new Error('should not be called');
        },
        async withTelegramIdentity<T>(): Promise<T> {
          throw new Error('should not be called');
        },
      },
      gate,
    );
    await expect(uow.withUser(userId(1), async () => 0)).rejects.toBeInstanceOf(ShutdownInProgressError);
  });
});

describe('shutdown', () => {
  it('finalizeRuntime ждёт drain, закрывает health и пул', async () => {
    const gate = createInFlightGate();
    const stopped: string[] = [];
    const bot = {
      running: true,
      isRunning() {
        return this.running;
      },
      async stop() {
        this.running = false;
        stopped.push('bot');
      },
    };
    const health = {
      port: 0,
      async close() {
        stopped.push('health');
      },
    };
    const pool = {
      async end() {
        stopped.push('pool');
      },
    };

    await finalizeRuntime({
      bot,
      pool: pool as never,
      health,
      gate,
    });
    expect(stopped).toEqual(['bot', 'health', 'pool']);
    expect(gate.isAccepting()).toBe(false);
  });
});

describe('артефакты развёртывания', () => {
  it('ожидаемые миграции читаются с диска и включают 0014', () => {
    const names = expectedMigrationNames(join(ROOT, 'migrations'));
    expect(names.at(-1)).toBe('0014_ops_grants');
    expect(names[0]).toBe('0001_roles_and_extensions');
  });

  it('systemd поднимает бота после reboot и чистит таблицы ролью обслуживания', () => {
    const unit = readFileSync(join(ROOT, 'deploy/systemd/izicrm.service'), 'utf8');
    expect(unit).toContain('WantedBy=multi-user.target');
    expect(unit).toContain('docker compose up -d --wait');

    const gc = readFileSync(join(ROOT, 'deploy/gc.sh'), 'utf8');
    expect(gc).toContain('izicrm_maintenance');
    expect(gc).not.toContain('izicrm_app');

    const backup = readFileSync(join(ROOT, 'deploy/backup.sh'), 'utf8');
    expect(backup).toContain('restore-verify.sh');
    expect(backup).toContain('pg_dump');
  });
});
