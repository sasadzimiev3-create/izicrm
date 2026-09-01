import { z } from 'zod';

import type { QuoteSource, UsdtRubQuote } from '../../application/ports/quote-source.js';

export const RAPIRA_RATES_URL = 'https://api.rapira.net/open/market/rates';

const CACHE_MS = 15_000;
const STALE_MS = 60_000;
const TIMEOUT_MS = 4_000;

const rateNumber = z.number().finite().positive();

const rateRow = z.object({
  symbol: z.string(),
  close: rateNumber,
  askPrice: rateNumber,
  bidPrice: rateNumber,
  baseCurrency: z.string().optional(),
  quoteCurrency: z.string().optional(),
});

const envelope = z.object({
  code: z.number(),
  data: z.array(z.unknown()),
});

export type QuoteFetch = (
  url: string,
  init: { headers: { Accept: string }; signal: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * Разбор ответа Rapira `GET /open/market/rates`. JSON-числа превращаются в строки
 * на этой границе; дальше тикер не считается как Money и не идёт в P&L.
 */
export function parseRapiraUsdtRub(payload: unknown): UsdtRubQuote | null {
  const parsed = envelope.safeParse(payload);
  if (!parsed.success || parsed.data.code !== 0) {
    return null;
  }
  for (const item of parsed.data.data) {
    const row = rateRow.safeParse(item);
    if (!row.success || !isUsdtRub(row.data.symbol, row.data.quoteCurrency, row.data.baseCurrency)) {
      continue;
    }
    return {
      bid: rateToString(row.data.bidPrice),
      ask: rateToString(row.data.askPrice),
      last: rateToString(row.data.close),
    };
  }
  return null;
}

export function createRapiraQuoteSource(
  options: { fetchFn?: QuoteFetch; nowFn?: () => number } = {},
): QuoteSource {
  const fetchFn: QuoteFetch = options.fetchFn ?? ((url, init) => fetch(url, init));
  const nowFn = options.nowFn ?? Date.now;
  let cached: { at: number; quote: UsdtRubQuote } | null = null;
  let inflight: Promise<UsdtRubQuote | null> | null = null;

  const fail = (): UsdtRubQuote | null => {
    if (cached !== null && nowFn() - cached.at < STALE_MS) {
      return cached.quote;
    }
    return null;
  };

  const load = async (): Promise<UsdtRubQuote | null> => {
    try {
      const res = await fetchFn(RAPIRA_RATES_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        return fail();
      }
      const quote = parseRapiraUsdtRub(await res.json());
      if (quote === null) {
        return fail();
      }
      cached = { at: nowFn(), quote };
      return quote;
    } catch {
      return fail();
    }
  };

  return {
    async getUsdtRub() {
      if (cached !== null && nowFn() - cached.at < CACHE_MS) {
        return cached.quote;
      }
      if (inflight !== null) {
        return inflight;
      }
      inflight = load().finally(() => {
        inflight = null;
      });
      return inflight;
    },
  };
}

function isUsdtRub(symbol: string, quoteCurrency: string | undefined, baseCurrency: string | undefined): boolean {
  if (symbol === 'USDT/RUB' || symbol === 'USDT_RUB') {
    return true;
  }
  return quoteCurrency === 'USDT' && baseCurrency === 'RUB';
}

function rateToString(value: number): string {
  return value.toFixed(2);
}
