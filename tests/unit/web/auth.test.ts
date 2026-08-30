import { createHmac, createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { userId } from '../../../src/domain/cards/card.js';
import { createWebAuth } from '../../../src/interface/web/auth.js';

describe('web auth tokens', () => {
  const auth = createWebAuth({
    secret: 'test-secret',
    publicUrl: 'http://127.0.0.1:3000',
    nowFn: () => new Date('2024-08-20T12:00:00Z'),
  });

  it('логин превращается в сессию; просроченный логин не проходит', () => {
    const uid = userId(7);
    const token = auth.issueLoginToken(uid, '1001');
    const principal = auth.verify(token, 'login');
    expect(principal?.userId).toBe(uid);
    expect(principal?.telegramId).toBe('1001');
    expect(auth.verify(token, 'session')).toBeNull();

    const url = auth.issueLoginUrl(uid, '1001');
    expect(url).toContain('http://127.0.0.1:3000/auth?token=');

    const expired = createWebAuth({
      secret: 'test-secret',
      publicUrl: 'http://127.0.0.1:3000',
      nowFn: () => new Date('2024-08-20T12:20:00Z'),
    });
    expect(expired.verify(token, 'login')).toBeNull();
  });

  it('проверяет подпись Telegram Login Widget', () => {
    const botToken = '123:abc';
    const widget = createWebAuth({
      secret: 'x',
      publicUrl: null,
      botToken,
      nowFn: () => new Date('2024-08-20T12:00:00Z'),
    });
    const fields: Record<string, string> = {
      id: '42',
      first_name: 'Ann',
      auth_date: String(Math.floor(Date.parse('2024-08-20T12:00:00Z') / 1000)),
    };
    const check = Object.keys(fields)
      .sort()
      .map((key) => `${key}=${fields[key] ?? ''}`)
      .join('\n');
    const secretKey = createHash('sha256').update(botToken).digest();
    fields.hash = createHmac('sha256', secretKey).update(check).digest('hex');
    expect(widget.verifyTelegramLogin(fields)).toBe('42');
    expect(widget.verifyTelegramLogin({ ...fields, hash: '00' })).toBeNull();
  });
});
