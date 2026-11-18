import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parseUserId } from '../../../src/infrastructure/db/ids.js';
import { parseBusinessDate } from '../../../src/domain/finance/period.js';
import { Money } from '../../../src/domain/money/money.js';
import { userId } from '../../../src/domain/cards/card.js';
import { createClock } from '../../../src/config/clock.js';
import { createAppServices } from '../../../src/application/services/create-services.js';
import { createDataAccess } from '../../../src/infrastructure/db/data-access.js';
import { createSafeLogger } from '../../../src/interface/telegram/log.js';
import { createWebAuth } from '../../../src/interface/web/auth.js';
import { defaultPublicDir, startWebServer } from '../../../src/interface/web/server.js';
import { insertUser, useAppDb } from '../harness.js';
import { unwrap } from '../services/app.js';

const D = parseBusinessDate;

describe('веб-кабинет и изоляция', () => {
  const db = useAppDb();

  it('запись через HTTP видна в dashboard-сервисе; чужой пользователь не видит данные', async () => {
    const pool = db.pool();
    const access = createDataAccess(pool);
    const services = createAppServices(access);
    const auth = createWebAuth({
      secret: 'cabinet-secret',
      publicUrl: 'http://127.0.0.1',
      nowFn: () => new Date('2024-08-20T12:00:00+03:00'),
    });
    const ownerTg = '88001';
    const strangerTg = '88002';
    const ownerId = parseUserId(await insertUser(pool, ownerTg));
    const strangerId = parseUserId(await insertUser(pool, strangerTg));

    const web = await startWebServer(
      {
        services,
        uow: access.uow,
        users: access.users,
        clock: createClock(() => new Date('2024-08-20T12:00:00+03:00')),
        logger: createSafeLogger(() => undefined),
        auth,
        publicDir: defaultPublicDir(),
        botUsername: null,
        quotes: null,
      },
      { host: '127.0.0.1', port: 0 },
    );

    try {
      const base = `http://127.0.0.1:${String(web.port)}`;
      const ownerCookie = await login(base, auth, ownerId, ownerTg);
      const create = await fetch(`${base}/api/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ name: 'Сбер 1111', amount: '15000' }),
      });
      expect(create.status).toBe(201);

      const dash = await services.dashboard.getDashboard(ownerId, D('2024-08-20'));
      expect(dash.totalCapital.toFixed()).toBe('15000.00');
      expect(dash.workingCards).toHaveLength(1);

      const overview = await fetch(`${base}/api/overview`, { headers: { cookie: ownerCookie } });
      expect(overview.status).toBe(200);
      const body = (await overview.json()) as { totalCapital: { amount: string }; journal: unknown[] };
      expect(body.totalCapital.amount).toBe('15000.00');
      expect(body.journal).toHaveLength(1);

      const strangerCookie = await login(base, auth, strangerId, strangerTg);
      const strangerView = await fetch(`${base}/api/overview`, { headers: { cookie: strangerCookie } });
      const strangerBody = (await strangerView.json()) as { journal: unknown[]; totalCapital: { amount: string } };
      expect(strangerBody.journal).toHaveLength(0);
      expect(strangerBody.totalCapital.amount).toBe('0.00');

      unwrap(
        await services.balanceUpdate.update(ownerId, {
          cardId: dash.workingCards[0]!.id,
          amount: Money.from('16000.00'),
          businessDate: D('2024-08-20'),
        }),
      );
      const afterTg = await fetch(`${base}/api/overview`, { headers: { cookie: ownerCookie } });
      const afterBody = (await afterTg.json()) as { totalCapital: { amount: string } };
      expect(afterBody.totalCapital.amount).toBe('16000.00');
    } finally {
      await web.close();
    }
  });

  it('журнал кабинета пишет заморозку по времени и пересчитывает капитал после исправления', async () => {
    const pool = db.pool();
    const access = createDataAccess(pool);
    const services = createAppServices(access);
    const auth = createWebAuth({
      secret: 'cabinet-secret',
      publicUrl: 'http://127.0.0.1',
      nowFn: () => new Date('2024-08-20T12:00:00+03:00'),
    });
    const ownerTg = '88011';
    const ownerId = parseUserId(await insertUser(pool, ownerTg));
    const web = await startWebServer(
      {
        services,
        uow: access.uow,
        users: access.users,
        clock: createClock(() => new Date('2024-08-20T12:00:00+03:00')),
        logger: createSafeLogger(() => undefined),
        auth,
        publicDir: defaultPublicDir(),
        botUsername: null,
        quotes: null,
      },
      { host: '127.0.0.1', port: 0 },
    );

    type OverviewBody = {
      totalCapital: { amount: string };
      workingShare: { formatted: string };
      materials: { id: number; status: string }[];
      journal: { kind: string; source: string | null; sourceLabel: string; canFix: boolean; at: string }[];
    };

    try {
      const base = `http://127.0.0.1:${String(web.port)}`;
      const cookie = await login(base, auth, ownerId, ownerTg);
      const created = await fetch(`${base}/api/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: 'Сбер 2222', amount: '15000' }),
      });
      expect(created.status).toBe(201);

      const beforeFreeze = (await (await fetch(`${base}/api/overview`, { headers: { cookie } })).json()) as OverviewBody;
      const cardId = beforeFreeze.materials[0]?.id;
      expect(cardId).toEqual(expect.any(Number));
      expect(beforeFreeze.journal).toHaveLength(1);
      expect(beforeFreeze.journal[0]?.kind).toBe('BALANCE');

      const freeze = await fetch(`${base}/api/freeze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ cardId }),
      });
      expect(freeze.status).toBe(200);

      const frozen = (await (await fetch(`${base}/api/overview`, { headers: { cookie } })).json()) as OverviewBody;
      expect(frozen.materials[0]?.status).toBe('frozen');
      expect(frozen.journal.map((row) => row.kind)).toEqual(['FREEZE', 'BALANCE']);
      expect(frozen.journal[0]?.sourceLabel).toBe('Заморозка');
      expect(frozen.journal[0]?.canFix).toBe(false);
      expect(frozen.journal[1]?.canFix).toBe(true);
      expect(Date.parse(frozen.journal[0]?.at ?? '')).toBeGreaterThanOrEqual(Date.parse(frozen.journal[1]?.at ?? ''));

      const unfreeze = await fetch(`${base}/api/unfreeze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ cardId }),
      });
      expect(unfreeze.status).toBe(200);

      const updated = await fetch(`${base}/api/balances`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ cardId, amount: '16500' }),
      });
      expect(updated.status).toBe(200);

      const after = (await (await fetch(`${base}/api/overview`, { headers: { cookie } })).json()) as OverviewBody;
      expect(after.totalCapital.amount).toBe('16500.00');
      expect(after.materials[0]?.status).toBe('working');
      expect(after.journal.map((row) => row.kind)).toEqual(['BALANCE', 'UNFREEZE', 'FREEZE', 'BALANCE']);
      expect(after.journal.some((row) => row.source === 'CORRECTION')).toBe(true);
      expect(after.journal[0]?.sourceLabel).toBe('Исправление');
    } finally {
      await web.close();
    }
  });

  it('котировка USDT/RUB приходит из порта строками; без источника — пустые цены, не 5xx', async () => {
    const pool = db.pool();
    const access = createDataAccess(pool);
    const services = createAppServices(access);
    const auth = createWebAuth({
      secret: 'cabinet-secret',
      publicUrl: 'http://127.0.0.1',
      nowFn: () => new Date('2024-08-20T12:00:00+03:00'),
    });
    const ownerTg = '88003';
    const ownerId = parseUserId(await insertUser(pool, ownerTg));

    const withQuote = await startWebServer(
      {
        services,
        uow: access.uow,
        users: access.users,
        clock: createClock(() => new Date('2024-08-20T12:00:00+03:00')),
        logger: createSafeLogger(() => undefined),
        auth,
        publicDir: defaultPublicDir(),
        botUsername: null,
        quotes: {
          async getUsdtRub() {
            return { bid: '87.86', ask: '87.87', last: '87.86' };
          },
        },
      },
      { host: '127.0.0.1', port: 0 },
    );

    try {
      const base = `http://127.0.0.1:${String(withQuote.port)}`;
      const cookie = await login(base, auth, ownerId, ownerTg);
      const quoted = await fetch(`${base}/api/quote/usdt-rub`, { headers: { cookie } });
      expect(quoted.status).toBe(200);
      expect(await quoted.json()).toEqual({
        href: 'https://rapira.net/ru/exchange/USDT_RUB',
        bid: '87.86',
        ask: '87.87',
        last: '87.86',
      });
    } finally {
      await withQuote.close();
    }

    const empty = await startWebServer(
      {
        services,
        uow: access.uow,
        users: access.users,
        clock: createClock(() => new Date('2024-08-20T12:00:00+03:00')),
        logger: createSafeLogger(() => undefined),
        auth,
        publicDir: defaultPublicDir(),
        botUsername: null,
        quotes: null,
      },
      { host: '127.0.0.1', port: 0 },
    );

    try {
      const base = `http://127.0.0.1:${String(empty.port)}`;
      const cookie = await login(base, auth, ownerId, ownerTg);
      const res = await fetch(`${base}/api/quote/usdt-rub`, { headers: { cookie } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        href: 'https://rapira.net/ru/exchange/USDT_RUB',
        bid: null,
        ask: null,
        last: null,
      });
    } finally {
      await empty.close();
    }
  });

  it('Mini App: своя сессия по initData, чужой снимок пустой, подделка не входит', async () => {
    const pool = db.pool();
    const access = createDataAccess(pool);
    const services = createAppServices(access);
    const botToken = '123:mini';
    const now = new Date('2024-08-20T12:00:00+03:00');
    const auth = createWebAuth({
      secret: 'cabinet-secret',
      publicUrl: 'http://127.0.0.1',
      botToken,
      nowFn: () => now,
    });
    const ownerTg = '88021';
    const strangerTg = '88022';
    await insertUser(pool, ownerTg);
    await insertUser(pool, strangerTg);
    const authDate = Math.floor(now.getTime() / 1000);

    const web = await startWebServer(
      {
        services,
        uow: access.uow,
        users: access.users,
        clock: createClock(() => now),
        logger: createSafeLogger(() => undefined),
        auth,
        publicDir: defaultPublicDir(),
        botUsername: null,
        quotes: null,
      },
      { host: '127.0.0.1', port: 0 },
    );

    try {
      const base = `http://127.0.0.1:${String(web.port)}`;
      const page = await fetch(`${base}/app`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('Откройте из Telegram');

      const forged = await fetch(`${base}/api/auth/webapp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData: signWebApp(botToken, ownerTg, authDate).replace(/hash=[0-9a-f]+/u, 'hash=00') }),
      });
      expect(forged.status).toBe(401);

      const ownerCookie = await webappLogin(base, signWebApp(botToken, ownerTg, authDate), false);
      const created = await fetch(`${base}/api/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ name: 'Сбер 3333', amount: '15000' }),
      });
      expect(created.status).toBe(201);
      const ownerView = (await (await fetch(`${base}/api/overview`, { headers: { cookie: ownerCookie } })).json()) as {
        journal: unknown[];
        totalCapital: { amount: string };
      };
      expect(ownerView.totalCapital.amount).toBe('15000.00');
      expect(ownerView.journal).toHaveLength(1);

      const strangerCookie = await webappLogin(base, signWebApp(botToken, strangerTg, authDate), true);
      const strangerView = (await (await fetch(`${base}/api/overview`, { headers: { cookie: strangerCookie } })).json()) as {
        journal: unknown[];
        totalCapital: { amount: string };
      };
      expect(strangerView.journal).toHaveLength(0);
      expect(strangerView.totalCapital.amount).toBe('0.00');
    } finally {
      await web.close();
    }
  });
});

function signWebApp(botToken: string, telegramId: string, authDate: number): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('query_id', 'AAE');
  params.set('user', JSON.stringify({ id: Number(telegramId), first_name: 'Ann' }));
  const check = [...params.entries()]
    .sort((left, right) => {
      if (left[0] < right[0]) {
        return -1;
      }
      if (left[0] > right[0]) {
        return 1;
      }
      return 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secretKey).update(check).digest('hex'));
  return params.toString();
}

async function webappLogin(base: string, initData: string, secure: boolean): Promise<string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secure) {
    headers['x-forwarded-proto'] = 'https';
  }
  const res = await fetch(`${base}/api/auth/webapp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ initData }),
  });
  expect(res.status).toBe(204);
  const setCookie = res.headers.get('set-cookie') ?? '';
  if (secure) {
    expect(setCookie).toContain('Secure');
  } else {
    expect(setCookie).not.toContain('Secure');
  }
  const pair = setCookie.split(';')[0];
  expect(pair).toBeTruthy();
  return pair ?? '';
}

async function login(
  base: string,
  auth: ReturnType<typeof createWebAuth>,
  uid: ReturnType<typeof userId>,
  telegramId: string,
): Promise<string> {
  const token = auth.issueLoginToken(uid, telegramId);
  const res = await fetch(`${base}/auth?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  expect(res.status).toBe(302);
  expect(setCookie).toBeTruthy();
  const pair = setCookie?.split(';')[0];
  expect(pair).toBeTruthy();
  return pair ?? '';
}
