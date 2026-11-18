import { createHmac, createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { userId } from '../../../src/domain/cards/card.js';
import { cookieIsSecure, createWebAuth } from '../../../src/interface/web/auth.js';

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

  it('проверяет подпись Mini App и отвергает подделку и просрочку', () => {
    const botToken = '123:abc';
    const authDate = Math.floor(Date.parse('2024-08-20T12:00:00Z') / 1000);
    const now = () => new Date('2024-08-20T12:00:00Z');
    const webapp = createWebAuth({ secret: 'x', publicUrl: 'http://127.0.0.1:3000', botToken, nowFn: now });
    const initData = signWebApp(botToken, '42', authDate);
    expect(webapp.verifyTelegramWebApp(initData)).toBe('42');
    expect(webapp.verifyTelegramWebApp('')).toBeNull();

    const forged = initData.replace(/hash=[0-9a-f]+/u, `hash=${'ab'.repeat(32)}`);
    expect(webapp.verifyTelegramWebApp(forged)).toBeNull();

    const widgetKey = createHash('sha256').update(botToken).digest();
    const params = new URLSearchParams(initData);
    const widgetHash = createHmac('sha256', widgetKey)
      .update(checkString(params))
      .digest('hex');
    params.set('hash', widgetHash);
    expect(webapp.verifyTelegramWebApp(params.toString())).toBeNull();

    const expired = createWebAuth({
      secret: 'x',
      publicUrl: null,
      botToken,
      nowFn: () => new Date((authDate + 86_401) * 1000),
    });
    expect(expired.verifyTelegramWebApp(initData)).toBeNull();
  });

  it('ставит Secure только если первый X-Forwarded-Proto — https', () => {
    expect(cookieIsSecure(undefined, false)).toBe(false);
    expect(cookieIsSecure('http', false)).toBe(false);
    expect(cookieIsSecure('https', false)).toBe(true);
    expect(cookieIsSecure('https, http', false)).toBe(true);
    expect(cookieIsSecure('http, https', false)).toBe(false);
    expect(cookieIsSecure(undefined, true)).toBe(true);
  });
});

function signWebApp(botToken: string, telegramId: string, authDate: number): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('query_id', 'AAE');
  params.set('user', JSON.stringify({ id: Number(telegramId), first_name: 'Ann' }));
  params.set('hash', webAppHash(botToken, params));
  return params.toString();
}

function checkString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort((left, right) => {
      if (left[0] < right[0]) return -1;
      if (left[0] > right[0]) return 1;
      return 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function webAppHash(botToken: string, params: URLSearchParams): string {
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secretKey).update(checkString(params)).digest('hex');
}
