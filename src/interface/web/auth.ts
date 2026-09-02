import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

import { userId, type UserId } from '../../domain/cards/card.js';

const LOGIN_TTL_SEC = 12 * 60 * 60;
const SESSION_TTL_SEC = 14 * 24 * 60 * 60;
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
 * Подпись входа: HMAC от секрета. Логин живёт 12 часов, сессия — 14 дней.
 * Telegram Login Widget проверяется по документации Bot API.
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
  };
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
