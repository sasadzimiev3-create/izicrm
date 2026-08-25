import { describe, expect, it } from 'vitest';

import { StaleCallbackError } from '../../../src/domain/errors.js';
import { assertFreshRev, isDialogExpired } from '../../../src/interface/telegram/fsm/guards.js';
import { encodeCallback, parseCallbackData } from '../../../src/interface/telegram/keyboards/callback-data.js';

describe('callback_data и ревизия', () => {
  it('кодирует v1:action:id:rev и не превышает 64 байта', () => {
    const data = encodeCallback('upd_one', 9007199254740991, 2147483647);
    expect(data.startsWith('v1:')).toBe(true);
    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
    const parsed = parseCallbackData(data);
    expect(parsed).toEqual({
      ok: true,
      version: 'v1',
      action: 'upd_one',
      id: '9007199254740991',
      rev: 2147483647,
    });
  });

  it('неизвестная версия не разбирается как действие', () => {
    expect(parseCallbackData('v2:home:-:1')).toEqual({ ok: false, reason: 'unknown_version' });
  });

  it('UI-09: несовпадение rev — StaleCallbackError', () => {
    expect(() => assertFreshRev(3, 2)).toThrow(StaleCallbackError);
    expect(() => assertFreshRev(3, 3)).not.toThrow();
  });

  it('истёкший диалог определяется по expires_at', () => {
    const now = new Date('2024-08-20T12:00:00.000Z');
    expect(isDialogExpired(new Date('2024-08-20T11:00:00.000Z'), now)).toBe(true);
    expect(isDialogExpired(new Date('2024-08-20T13:00:00.000Z'), now)).toBe(false);
  });
});
