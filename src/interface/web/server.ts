import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import type { AppServices } from '../../application/services/create-services.js';
import { USDT_RUB_PAGE, type QuoteSource } from '../../application/ports/quote-source.js';
import type { UserRepository } from '../../application/ports/user-repository.js';
import type { UnitOfWork } from '../../application/ports/unit-of-work.js';
import type { Clock } from '../../config/clock.js';
import { cardId } from '../../domain/cards/card.js';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/errors.js';
import { parseAmount } from '../../domain/money/parse.js';
import type { AppLogger } from '../telegram/log.js';

import {
  clearSessionCookie,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  type AuthPrincipal,
  type WebAuth,
} from './auth.js';
import { serializeSnapshot } from './serialize.js';

const BODY_LIMIT = 64 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const cardIdSchema = z.number().int().positive();
const amountSchema = z.string().min(1);
const archiveSchema = z.object({
  cardId: cardIdSchema,
  reason: z.enum(['WITHDRAWN', 'TRANSFERRED', 'LOST']),
  targetCardId: z.number().int().positive().optional(),
});

export type WebDeps = {
  services: AppServices;
  uow: UnitOfWork;
  users: UserRepository;
  clock: Clock;
  logger: AppLogger;
  auth: WebAuth;
  publicDir: string;
  botUsername: string | null;
  quotes: QuoteSource | null;
};

export type WebServer = {
  port: number;
  close(): Promise<void>;
};

export function defaultPublicDir(): string {
  return join(fileURLToPath(new URL('.', import.meta.url)), '../../../web/public');
}

/**
 * HTTP-кабинет. Те же application-сервисы, что Telegram — одна база, без второй формулы P&L.
 */
export function startWebServer(
  deps: WebDeps,
  options: { host?: string; port?: number } = {},
): Promise<WebServer> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 3000;
  const server = http.createServer((req, res) => {
    void handleRequest(deps, req, res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      const bound = typeof address === 'object' && address !== null ? address.port : port;
      resolve({
        port: bound,
        close() {
          return new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          });
        },
      });
    });
  });
}

async function handleRequest(
  deps: WebDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const host = req.headers.host ?? 'localhost';
    const url = new URL(req.url ?? '/', `http://${host}`);
    const method = req.method ?? 'GET';

    if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/health/')) {
      json(res, 200, { ok: true });
      return;
    }
    if (method === 'GET' && url.pathname === '/api/config') {
      json(res, 200, {
        botUsername: deps.botUsername,
        telegramLogin: deps.botUsername !== null,
      });
      return;
    }
    if (method === 'GET' && url.pathname === '/auth') {
      await handleAuthRedirect(deps, url, res);
      return;
    }
    if (method === 'POST' && url.pathname === '/api/auth/telegram') {
      await handleTelegramLogin(deps, req, res);
      return;
    }
    if (method === 'POST' && url.pathname === '/api/logout') {
      res.statusCode = 204;
      res.setHeader('set-cookie', clearSessionCookie(deps.auth.cookieSecure));
      res.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      const session = sessionOf(deps, req);
      if (session === null) {
        json(res, 401, { error: 'Нужен вход' });
        return;
      }
      await handleApi(deps, session, method, url.pathname, req, res);
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      json(res, 405, { error: 'method not allowed' });
      return;
    }

    const session = sessionOf(deps, req);
    if (url.pathname === '/' || url.pathname === '') {
      await sendFile(deps.publicDir, session === null ? 'login.html' : 'index.html', res);
      return;
    }
    if (url.pathname === '/login') {
      await sendFile(deps.publicDir, 'login.html', res);
      return;
    }
    await sendFile(deps.publicDir, url.pathname.slice(1), res);
  } catch (error) {
    sendCaught(deps, res, error);
  }
}

function sessionOf(deps: WebDeps, req: http.IncomingMessage): AuthPrincipal | null {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (token === null) {
    return null;
  }
  return deps.auth.verify(token, 'session');
}

async function handleAuthRedirect(deps: WebDeps, url: URL, res: http.ServerResponse): Promise<void> {
  const token = url.searchParams.get('token');
  if (token === null || token === '') {
    redirect(res, '/login');
    return;
  }
  const principal = deps.auth.verify(token, 'login');
  if (principal === null) {
    redirect(res, '/login?error=expired');
    return;
  }
  const session = deps.auth.issueSessionToken(principal.userId, principal.telegramId);
  res.statusCode = 302;
  res.setHeader('set-cookie', sessionCookie(session, deps.auth.cookieSecure));
  res.setHeader('location', '/');
  res.end();
}

async function handleTelegramLogin(
  deps: WebDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readJson(req);
  const fields: Record<string, string> = {};
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'string' || typeof value === 'number') {
        fields[key] = String(value);
      }
    }
  }
  const telegramId = deps.auth.verifyTelegramLogin(fields);
  if (telegramId === null) {
    json(res, 401, { error: 'Вход через Telegram не принят' });
    return;
  }
  const user = await deps.uow.withTelegramIdentity(telegramId, (tx) =>
    deps.users.findOrCreateByTelegramId(telegramId, tx),
  );
  const session = deps.auth.issueSessionToken(user.id, user.telegramId);
  res.statusCode = 204;
  res.setHeader('set-cookie', sessionCookie(session, deps.auth.cookieSecure));
  res.end();
}

async function handleApi(
  deps: WebDeps,
  session: AuthPrincipal,
  method: string,
  pathname: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const user = await deps.uow.withTelegramIdentity(session.telegramId, (tx) =>
    deps.users.getUserByTelegramId(session.telegramId, tx),
  );
  if (user === null || user.id !== session.userId) {
    json(res, 401, { error: 'Нужен вход' });
    return;
  }
  const today = deps.clock.businessDate(user.tz);

  if (method === 'GET' && pathname === '/api/me') {
    json(res, 200, { telegramId: user.telegramId, today });
    return;
  }
  if (method === 'GET' && pathname === '/api/overview') {
    const snapshot = await deps.services.stats.getSnapshot(user.id, today);
    json(res, 200, serializeSnapshot(snapshot));
    return;
  }
  if (method === 'GET' && pathname === '/api/quote/usdt-rub') {
    const quote = deps.quotes === null ? null : await deps.quotes.getUsdtRub();
    json(res, 200, {
      href: USDT_RUB_PAGE,
      bid: quote?.bid ?? null,
      ask: quote?.ask ?? null,
      last: quote?.last ?? null,
    });
    return;
  }
  if (method !== 'POST') {
    json(res, 405, { error: 'method not allowed' });
    return;
  }

  const body = await readJson(req);
  if (pathname === '/api/cards') {
    const parsed = z.object({ name: z.string().min(1), amount: amountSchema }).parse(body);
    await deps.services.card.create(user.id, {
      name: parsed.name,
      amount: parseAmount(parsed.amount),
      createdOn: today,
    });
    json(res, 201, { ok: true });
    return;
  }
  if (pathname === '/api/balances') {
    const parsed = z.object({ cardId: cardIdSchema, amount: amountSchema }).parse(body);
    await deps.services.balanceUpdate.update(user.id, {
      cardId: cardId(parsed.cardId),
      amount: parseAmount(parsed.amount),
      businessDate: today,
    });
    json(res, 200, { ok: true });
    return;
  }
  if (pathname === '/api/topup') {
    const parsed = z.object({ cardId: cardIdSchema, newAmount: amountSchema }).parse(body);
    await deps.services.topup.topUp(user.id, {
      cardId: cardId(parsed.cardId),
      newAmount: parseAmount(parsed.newAmount),
      businessDate: today,
    });
    json(res, 200, { ok: true });
    return;
  }
  if (pathname === '/api/spend') {
    const parsed = z.object({ cardId: cardIdSchema, newAmount: amountSchema }).parse(body);
    await deps.services.spend.spend(user.id, {
      cardId: cardId(parsed.cardId),
      newAmount: parseAmount(parsed.newAmount),
      businessDate: today,
    });
    json(res, 200, { ok: true });
    return;
  }
  if (pathname === '/api/freeze') {
    const parsed = z.object({ cardId: cardIdSchema }).parse(body);
    await deps.services.freeze.freeze(user.id, { cardId: cardId(parsed.cardId), frozenOn: today });
    json(res, 200, { ok: true });
    return;
  }
  if (pathname === '/api/unfreeze') {
    const parsed = z.object({ cardId: cardIdSchema }).parse(body);
    await deps.services.freeze.unfreeze(user.id, { cardId: cardId(parsed.cardId) });
    json(res, 200, { ok: true });
    return;
  }
  if (pathname === '/api/archive') {
    const parsed = archiveSchema.parse(body);
    await deps.services.archive.archive(user.id, {
      cardId: cardId(parsed.cardId),
      archivedOn: today,
      reason: parsed.reason,
      ...(parsed.targetCardId === undefined ? {} : { targetCardId: cardId(parsed.targetCardId) }),
    });
    json(res, 200, { ok: true });
    return;
  }
  json(res, 404, { error: 'not found' });
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > BODY_LIMIT) {
      throw new ValidationError('Слишком большой запрос');
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ValidationError('Некорректный JSON');
  }
}

async function sendFile(publicDir: string, relativePath: string, res: http.ServerResponse): Promise<void> {
  const safe = normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/u, '');
  const full = join(publicDir, safe);
  const rel = relative(publicDir, full);
  if (rel.startsWith('..') || rel.startsWith(`..${sep}`)) {
    json(res, 404, { error: 'not found' });
    return;
  }
  if (!existsSync(full) || !statSync(full).isFile()) {
    json(res, 404, { error: 'not found' });
    return;
  }
  const type = MIME[extname(full)] ?? 'application/octet-stream';
  res.statusCode = 200;
  res.setHeader('content-type', type);
  res.setHeader('cache-control', type.includes('html') ? 'no-store' : 'public, max-age=3600');
  createReadStream(full).pipe(res);
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function redirect(res: http.ServerResponse, location: string): void {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.end();
}

function sendCaught(deps: WebDeps, res: http.ServerResponse, error: unknown): void {
  if (error instanceof z.ZodError) {
    json(res, 400, { error: 'Некорректный запрос' });
    return;
  }
  if (error instanceof ValidationError) {
    json(res, 400, { error: error.message });
    return;
  }
  if (error instanceof NotFoundError) {
    json(res, 404, { error: error.message });
    return;
  }
  if (error instanceof ConflictError) {
    json(res, 409, { error: error.message });
    return;
  }
  deps.logger.error({ userId: 0, correlationId: 'web', err: String(error) }, 'web error');
  json(res, 500, { error: 'Что-то пошло не так' });
}
