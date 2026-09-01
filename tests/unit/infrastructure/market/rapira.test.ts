import { describe, expect, it } from 'vitest';

import {
  createRapiraQuoteSource,
  parseRapiraUsdtRub,
  RAPIRA_RATES_URL,
  type QuoteFetch,
} from '../../../../src/infrastructure/market/rapira.js';

const USDT_RUB = {
  symbol: 'USDT/RUB',
  close: 87.86,
  askPrice: 87.87,
  bidPrice: 87.86,
  baseCurrency: 'RUB',
  quoteCurrency: 'USDT',
};

const BTC = {
  symbol: 'BTC/USDT',
  close: 77661,
  askPrice: 77969,
  bidPrice: 77681.5,
  baseCurrency: 'USDT',
  quoteCurrency: 'BTC',
};

function envelope(rows: unknown[], code = 0) {
  return { data: rows, code, message: 'SUCCESS' };
}

describe('parseRapiraUsdtRub', () => {
  it('достаёт bid/ask/last USDT/RUB и сразу делает строки', () => {
    expect(parseRapiraUsdtRub(envelope([BTC, USDT_RUB]))).toEqual({
      bid: '87.86',
      ask: '87.87',
      last: '87.86',
    });
  });

  it('принимает символ USDT_RUB', () => {
    expect(parseRapiraUsdtRub(envelope([{ ...USDT_RUB, symbol: 'USDT_RUB' }]))).toEqual({
      bid: '87.86',
      ask: '87.87',
      last: '87.86',
    });
  });

  it('находит пару по валютам, если символ другой', () => {
    expect(
      parseRapiraUsdtRub(envelope([{ ...USDT_RUB, symbol: 'tether-rub' }])),
    ).toEqual({
      bid: '87.86',
      ask: '87.87',
      last: '87.86',
    });
  });

  it('пропускает битую строку и берёт следующую USDT/RUB', () => {
    expect(parseRapiraUsdtRub(envelope([{ symbol: 'USDT/RUB' }, USDT_RUB]))).toEqual({
      bid: '87.86',
      ask: '87.87',
      last: '87.86',
    });
  });

  it('без пары, с ошибкой Rapira или пустым телом — null, не ноль', () => {
    expect(parseRapiraUsdtRub(envelope([BTC]))).toBeNull();
    expect(parseRapiraUsdtRub(envelope([USDT_RUB], 1))).toBeNull();
    expect(parseRapiraUsdtRub({})).toBeNull();
    expect(parseRapiraUsdtRub(null)).toBeNull();
    expect(parseRapiraUsdtRub(envelope([{ ...USDT_RUB, bidPrice: 0 }]))).toBeNull();
    expect(parseRapiraUsdtRub(envelope([{ ...USDT_RUB, askPrice: -1 }]))).toBeNull();
  });
});

describe('createRapiraQuoteSource', () => {
  it('кэширует ответ 15 с и не ходит в сеть повторно', async () => {
    let now = 0;
    let calls = 0;
    const fetchFn: QuoteFetch = async (url) => {
      calls += 1;
      expect(url).toBe(RAPIRA_RATES_URL);
      return { ok: true, json: async () => envelope([USDT_RUB]) };
    };
    const source = createRapiraQuoteSource({ fetchFn, nowFn: () => now });
    await expect(source.getUsdtRub()).resolves.toEqual({
      bid: '87.86',
      ask: '87.87',
      last: '87.86',
    });
    now = 14_999;
    await source.getUsdtRub();
    expect(calls).toBe(1);
    now = 15_000;
    await source.getUsdtRub();
    expect(calls).toBe(2);
  });

  it('параллельные запросы делят один inflight', async () => {
    const waiters: Array<(value: { ok: boolean; json: () => Promise<unknown> }) => void> = [];
    const fetchFn: QuoteFetch = () =>
      new Promise((resolve) => {
        waiters.push(resolve);
      });
    const source = createRapiraQuoteSource({ fetchFn, nowFn: () => 0 });
    const first = source.getUsdtRub();
    const second = source.getUsdtRub();
    expect(waiters).toHaveLength(1);
    waiters[0]!({ ok: true, json: async () => envelope([USDT_RUB]) });
    await expect(first).resolves.toEqual({ bid: '87.86', ask: '87.87', last: '87.86' });
    await expect(second).resolves.toEqual({ bid: '87.86', ask: '87.87', last: '87.86' });
  });

  it('при ошибке отдаёт устаревшую котировку до минуты, потом null', async () => {
    let now = 0;
    let failNext = false;
    const fetchFn: QuoteFetch = async () => {
      if (failNext) {
        throw new Error('network');
      }
      return { ok: true, json: async () => envelope([USDT_RUB]) };
    };
    const source = createRapiraQuoteSource({ fetchFn, nowFn: () => now });
    await source.getUsdtRub();
    failNext = true;
    now = 16_000;
    await expect(source.getUsdtRub()).resolves.toEqual({
      bid: '87.86',
      ask: '87.87',
      last: '87.86',
    });
    now = 60_000;
    await expect(source.getUsdtRub()).resolves.toBeNull();
  });

  it('HTTP не ok, битый JSON и пустой разбор без кэша дают null', async () => {
    const notOk = createRapiraQuoteSource({
      nowFn: () => 0,
      fetchFn: async () => ({ ok: false, json: async () => envelope([USDT_RUB]) }),
    });
    await expect(notOk.getUsdtRub()).resolves.toBeNull();

    const badJson = createRapiraQuoteSource({
      nowFn: () => 0,
      fetchFn: async () => ({
        ok: true,
        json: async () => {
          throw new Error('json');
        },
      }),
    });
    await expect(badJson.getUsdtRub()).resolves.toBeNull();

    const empty = createRapiraQuoteSource({
      nowFn: () => 0,
      fetchFn: async () => ({ ok: true, json: async () => envelope([]) }),
    });
    await expect(empty.getUsdtRub()).resolves.toBeNull();
  });

  it('после успешного кэша HTTP не ok всё ещё отдаёт устаревшую цену', async () => {
    let now = 0;
    let ok = true;
    const fetchFn: QuoteFetch = async () => {
      if (!ok) {
        return { ok: false, json: async () => ({}) };
      }
      return { ok: true, json: async () => envelope([USDT_RUB]) };
    };
    const source = createRapiraQuoteSource({ fetchFn, nowFn: () => now });
    await source.getUsdtRub();
    ok = false;
    now = 20_000;
    await expect(source.getUsdtRub()).resolves.toEqual({
      bid: '87.86',
      ask: '87.87',
      last: '87.86',
    });
  });
});
