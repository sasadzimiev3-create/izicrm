import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

import { userId, type UserId } from '../../domain/cards/card.js';

const LOGIN_TTL_SEC = 15 * 60;
const SESSION_TTL_SEC = 14 * 24 * 60 * 60;
const WEBAPP_MAX_AGE_SEC = 24 * 60 * 60;
export const SESSION_COOKIE = 'izicrm_session';

export type TokenKind = 'login' | 'session';

export type AuthPrincipal = {
  userId: UserId;
  telegramId: string;
  kind: TokenKind;
  exp: number;
};

export type WebAuth = {
  publicUrl: string | null;
  cookieSecure: boolean;
  issueLoginToken(userId: UserId, telegramId: string): string;
  issueSessionToken(userId: UserId, telegramId: string): string;
  issueLoginUrl(userId: UserId, telegramId: string): string | null;
  verify(token: string, kind: TokenKind, nowSec?: number): AuthPrincipal | null;
  verifyTelegramLogin(fields: Record<string, string>, nowSec?: number): string | null;
  /** Mini App initData. Ключ другой, чем у Login Widget: HMAC("WebAppData", bot token). */
  verifyTelegramWebApp(initData: string, nowSec?: number): string | null;
};

function b64url(value: Buffer | string): string {
  const buf = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  return buf.toString('base64url');
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function issue(secret: string, kind: TokenKind, uid: UserId, telegramId: string, ttlSec: number, nowSec: number): string {
  const exp = nowSec + ttlSec;
  const payload = `${kind}:${String(uid)}:${telegramId}:${String(exp)}`;
  return `${b64url(payload)}.${sign(secret, payload)}`;
}

function parseToken(secret: string, token: string, kind: TokenKind, nowSec: number): AuthPrincipal | null {
  const parts = token.split('.');
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    return null;
  }
  let payload: string;
  try {
    payload = Buffer.from(parts[0], 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!equal(sign(secret, payload), parts[1])) {
    return null;
  }
  const fields = payload.split(':');
  if (fields.length !== 4) {
    return null;
  }
  const [gotKind, idRaw, telegramId, expRaw] = fields;
  if (gotKind !== kind || idRaw === undefined || telegramId === undefined || expRaw === undefined) {
    return null;
  }
  if (!/^[1-9]\d*$/u.test(idRaw) || !/^[1-9]\d*$/u.test(telegramId) || !/^\d+$/u.test(expRaw)) {
    return null;
  }
  const exp = Number(expRaw);
  if (exp <= nowSec) {
    return null;
  }
  try {
    return { userId: userId(Number(idRaw)), telegramId, kind, exp };
  } catch {
    return null;
  }
}

/**
 * Подпись входа: HMAC от секрета. Логин живёт 15 минут, сессия — 14 дней.
 * Login Widget: ключ SHA-256 от токена бота.
 * Mini App: ключ HMAC-SHA256("WebAppData", токен бота). Это разные проверки.
 */
export function createWebAuth(opts: {
  secret: string;
  publicUrl: string | null;
  botToken?: string;
  nowFn?: () => Date;
}): WebAuth {
  const secret = opts.secret;
  const publicUrl = opts.publicUrl;
  const botToken = opts.botToken;
  const cookieSecure = publicUrl !== null && publicUrl.startsWith('https://');
  const now = opts.nowFn ?? (() => new Date());
  const nowSec = (): number => Math.floor(now().getTime() / 1000);

  return {
    publicUrl,
    cookieSecure,
    issueLoginToken(uid, telegramId) {
      return issue(secret, 'login', uid, telegramId, LOGIN_TTL_SEC, nowSec());
    },
    issueSessionToken(uid, telegramId) {
      return issue(secret, 'session', uid, telegramId, SESSION_TTL_SEC, nowSec());
    },
    issueLoginUrl(uid, telegramId) {
      if (publicUrl === null || publicUrl === '') {
        return null;
      }
      const token = issue(secret, 'login', uid, telegramId, LOGIN_TTL_SEC, nowSec());
      const base = publicUrl.replace(/\/$/u, '');
      return `${base}/auth?token=${encodeURIComponent(token)}`;
    },
    verify(token, kind, at = nowSec()) {
      return parseToken(secret, token, kind, at);
    },
    verifyTelegramLogin(fields, at = nowSec()) {
      if (botToken === undefined || botToken === '') {
        return null;
      }
      const hash = fields['hash'];
      const authDateRaw = fields['auth_date'];
      const telegramId = fields['id'];
      if (hash === undefined || authDateRaw === undefined || telegramId === undefined) {
        return null;
      }
      if (!/^[1-9]\d*$/u.test(telegramId) || !/^\d+$/u.test(authDateRaw)) {
        return null;
      }
      const authDate = Number(authDateRaw);
      if (at - authDate > 86_400) {
        return null;
      }
      const checkString = Object.keys(fields)
        .filter((key) => key !== 'hash')
        .sort()
        .map((key) => `${key}=${fields[key] ?? ''}`)
        .join('\n');
      const secretKey = createHash('sha256').update(botToken).digest();
      const digest = createHmac('sha256', secretKey).update(checkString).digest('hex');
      if (!equal(digest, hash)) {
        return null;
      }
      return telegramId;
    },
    verifyTelegramWebApp(initData, at = nowSec()) {
      return verifyWebAppInitData(botToken, initData, at);
    },
  };
}

/**
 * Secure только за HTTPS-прокси. Прямой запрос на :3000 флаг не получает,
 * даже если клиент прислал другой протокол вторым значением.
 */
export function cookieIsSecure(forwardedProto: string | string[] | undefined, publicUrlSecure: boolean): boolean {
  const raw = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  if (typeof raw === 'string') {
    const first = raw.split(',')[0]?.trim().toLowerCase();
    if (first === 'https') {
      return true;
    }
  }
  return publicUrlSecure;
}

function verifyWebAppInitData(botToken: string | undefined, initData: string, at: number): string | null {
  if (botToken === undefined || botToken === '' || initData.trim() === '') {
    return null;
  }
  const raw = initData.startsWith('?') ? initData.slice(1) : initData;
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  const authDateRaw = params.get('auth_date');
  const userRaw = params.get('user');
  if (hash === null || authDateRaw === null || userRaw === null) {
    return null;
  }
  if (!/^\d+$/u.test(authDateRaw)) {
    return null;
  }
  const authDate = Number(authDateRaw);
  if (!Number.isSafeInteger(authDate) || at - authDate > WEBAPP_MAX_AGE_SEC) {
    return null;
  }
  const entries: [string, string][] = [];
  for (const [key, value] of params.entries()) {
    if (key !== 'hash') {
      entries.push([key, value]);
    }
  }
  entries.sort((left, right) => {
    if (left[0] < right[0]) {
      return -1;
    }
    if (left[0] > right[0]) {
      return 1;
    }
    return 0;
  });
  const checkString = entries.map(([key, value]) => `${key}=${value}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const digest = createHmac('sha256', secretKey).update(checkString).digest('hex');
  if (!equal(digest, hash.toLowerCase())) {
    return null;
  }
  return telegramIdFromUserJson(userRaw);
}

function telegramIdFromUserJson(userRaw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(userRaw) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('id' in parsed)) {
    return null;
  }
  const id = parsed.id;
  if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) {
    return String(id);
  }
  if (typeof id === 'string' && /^[1-9]\d*$/u.test(id)) {
    return id;
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${String(SESSION_TTL_SEC)}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined || header === '') {
    return null;
  }
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    if (trimmed.slice(0, eq) === name) {
      return trimmed.slice(eq + 1);
    }
  }
  return null;
}
