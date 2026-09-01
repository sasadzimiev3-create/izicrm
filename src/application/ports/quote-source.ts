/**
 * Котировка USDT/RUB для шапки кабинета. Это рыночный тикер, не деньги пользователя:
 * в periodPnl, капитал и отчёты не входит.
 *
 * bid/ask/last — десятичные строки (как деньги в JSON), не number.
 */
export type UsdtRubQuote = {
  bid: string;
  ask: string;
  last: string;
};

export type QuoteSource = {
  getUsdtRub(): Promise<UsdtRubQuote | null>;
};

export const USDT_RUB_PAGE = 'https://rapira.net/ru/exchange/USDT_RUB';
