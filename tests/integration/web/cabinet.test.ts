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
});

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
