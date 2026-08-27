import { describe, expect, it } from 'vitest';

import type { ProcessedUpdateRepository } from '../../../src/application/ports/processed-update-repository.js';
import type { DbTx } from '../../../src/application/ports/unit-of-work.js';
import { once } from '../../../src/application/services/support.js';
import { USER } from '../finance/fixtures.js';

const TX = {} as DbTx;

describe('once — ключ идемпотентности', () => {
  it('без ключа не вызывает claim и всегда выполняет работу', async () => {
    let work = 0;
    const processed: ProcessedUpdateRepository = {
      claim: async () => {
        throw new Error('claim must not run without key');
      },
    };
    const result = await once(processed, USER, undefined, TX, async () => {
      work += 1;
      return 'ok';
    });
    expect(result).toEqual({ applied: true, value: 'ok' });
    expect(work).toBe(1);
  });
});
