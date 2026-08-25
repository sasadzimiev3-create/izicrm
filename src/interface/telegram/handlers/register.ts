import { Bot, GrammyError, InputFile, type Context } from 'grammy';

import type { DbTx } from '../../../application/ports/unit-of-work.js';
import type { TelegramDeps } from '../deps.js';
import { toInlineMarkup, type Keyboard } from '../keyboards/keyboards.js';
import type { TelegramSender } from '../protocol.js';
import { handleIncoming } from '../runtime.js';

function senderFrom(ctx: Context): TelegramSender {
  return {
    async sendMessage(text: string, keyboard?: Keyboard): Promise<void> {
      if (keyboard === undefined) {
        await ctx.reply(text);
        return;
      }
      await ctx.reply(text, { reply_markup: toInlineMarkup(keyboard) });
    },
    async sendDocument(file: Buffer, filename: string): Promise<void> {
      await ctx.replyWithDocument(new InputFile(file, filename));
    },
    async answerCallback(text?: string): Promise<void> {
      if (ctx.callbackQuery === undefined) {
        return;
      }
      if (text === undefined) {
        await ctx.answerCallbackQuery();
        return;
      }
      await ctx.answerCallbackQuery({ text });
    },
  };
}

function isBlocked(error: unknown): boolean {
  return error instanceof GrammyError && error.error_code === 403;
}

/**
 * Регистрирует handlers. grammY живёт в interface — слой не импортирует infrastructure.
 */
export function registerTelegramHandlers(bot: Bot, deps: TelegramDeps): void {
  bot.on('message:text', async (ctx) => {
    const from = ctx.from;
    const text = ctx.message.text;
    if (from === undefined) {
      return;
    }
    await handleIncoming(
      deps,
      {
        kind: 'message',
        updateId: ctx.update.update_id,
        telegramId: String(from.id),
        text,
      },
      senderFrom(ctx),
    );
  });

  bot.on('callback_query:data', async (ctx) => {
    const from = ctx.from;
    const data = ctx.callbackQuery.data;
    if (from === undefined) {
      return;
    }
    await handleIncoming(
      deps,
      {
        kind: 'callback',
        updateId: ctx.update.update_id,
        telegramId: String(from.id),
        data,
      },
      senderFrom(ctx),
    );
  });

  bot.catch(async (error) => {
    if (!isBlocked(error.error)) {
      deps.logger.error(
        { userId: 0, correlationId: 'bot.catch', err: String(error.error) },
        'telegram error',
      );
      return;
    }
    const telegramId = error.ctx.from === undefined ? undefined : String(error.ctx.from.id);
    if (telegramId === undefined) {
      return;
    }
    await deps.uow.withTelegramIdentity(telegramId, (tx: DbTx) => deps.users.markUserBlocked(telegramId, tx));
  });
}
