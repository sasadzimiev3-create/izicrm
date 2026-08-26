import { Bot } from 'grammy';
import { HttpsProxyAgent } from 'https-proxy-agent';

export type TelegramBotOptions = {
  /** HTTP или SOCKS5 URL, например http://user:pass@host:8000 */
  proxyUrl?: string | undefined;
};

/**
 * Создаёт grammY Bot. При `proxyUrl` трафик к Telegram API идёт через прокси.
 *
 * grammY в Node использует node-fetch; ему нужен `agent` (HttpsProxyAgent),
 * а не undici `dispatcher` — иначе запросы идут напрямую и зависают.
 *
 * @see https://grammy.dev/advanced/proxy
 */
export function createTelegramBot(token: string, options: TelegramBotOptions = {}): Bot {
  const proxyUrl = options.proxyUrl?.trim();
  if (proxyUrl === undefined || proxyUrl === '') {
    return new Bot(token);
  }

  const agent = new HttpsProxyAgent(proxyUrl);
  return new Bot(token, {
    client: {
      baseFetchConfig: {
        agent,
        compress: true,
      } as RequestInit,
    },
  });
}
