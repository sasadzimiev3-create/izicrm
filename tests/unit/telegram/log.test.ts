import { describe, expect, it } from 'vitest';

import { createSafeLogger } from '../../../src/interface/telegram/log.js';

describe('логи без денежных сумм', () => {
  it('пишет user_id и correlation id', () => {
    const lines: string[] = [];
    const log = createSafeLogger((line) => lines.push(line));
    log.info({ userId: 42, correlationId: 'upd-9', updateId: 9 }, 'handled');
    expect(lines[0]).toContain('"userId":42');
    expect(lines[0]).toContain('"correlationId":"upd-9"');
    expect(lines[0]).not.toMatch(/₽/);
  });

  it('отказывается логировать сумму', () => {
    const log = createSafeLogger(() => undefined);
    expect(() =>
      log.info({ userId: 1, correlationId: 'x', amount: '100' } as never, 'nope'),
    ).toThrow(/monetary/);
  });
});
