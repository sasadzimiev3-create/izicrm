import { describe, expect, it } from 'vitest';
import { Bot } from 'grammy';
import { createTelegramBot } from '../../../../src/infrastructure/telegram/bot.js';

describe('createTelegramBot', () => {
  it('creates a Bot without proxy', () => {
    const bot = createTelegramBot('123:ABC');
    expect(bot).toBeInstanceOf(Bot);
  });

  it('creates a Bot with HTTP proxy dispatcher', () => {
    const bot = createTelegramBot('123:ABC', {
      proxyUrl: 'http://user:pass@127.0.0.1:8000',
    });
    expect(bot).toBeInstanceOf(Bot);
  });

  it('treats blank proxyUrl as no proxy', () => {
    const bot = createTelegramBot('123:ABC', { proxyUrl: '  ' });
    expect(bot).toBeInstanceOf(Bot);
  });
});
