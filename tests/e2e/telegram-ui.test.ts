import { describe, expect, it } from 'vitest';

import { encodeCallback } from '../../src/interface/telegram/keyboards/callback-data.js';
import { COPY } from '../../src/interface/telegram/views/copy.js';
import { CUSTOM_EMOJI_ID } from '../../src/interface/telegram/views/custom-emoji.js';
import { parseCallbackData } from '../../src/interface/telegram/keyboards/callback-data.js';
import { insertUser, useAppDb, withUser } from '../integration/harness.js';

import { TelegramProbe } from './probe.js';

async function createMaterial(bot: TelegramProbe, name: string, amount: string): Promise<void> {
  await bot.send('/start');
  await bot.tapLabel(COPY.topUpMenu);
  await bot.tapLabel('Добавить материал');
  await bot.send(name);
  await bot.send(amount);
}

describe('Telegram e2e (UI-06…UI-13, UI-15…UI-17)', () => {
  const db = useAppDb();

  it('UI-05: полный проход создания; на главном четыре кнопки (FR-6.2)', async () => {
    const bot = new TelegramProbe(db.pool(), '601');
    await insertUser(db.pool(), '601');
    await createMaterial(bot, 'Сбер1', '10000');
    expect(bot.last.allTexts()).toContain('Сбер1');
    expect(bot.last.allTexts()).not.toMatch(/просто прибыль|это прибыль|PROFIT/i);
    const labels = (bot.last.lastKeyboard ?? []).map((row) => row.map((button) => button.text).join());
    expect(labels.some((text) => text.includes('Обновить балансы'))).toBe(true);
    expect(labels.some((text) => text.includes(COPY.topUpMenu))).toBe(true);
    expect(labels.some((text) => text.includes(COPY.expenseMenu))).toBe(true);
    expect(labels.some((text) => text.includes('Настройки'))).toBe(true);
    const topUp = (bot.last.lastKeyboard ?? []).flat().find((button) => button.text === COPY.topUpMenu);
    const spend = (bot.last.lastKeyboard ?? []).flat().find((button) => button.text === COPY.expenseMenu);
    expect(topUp?.style).toBe('success');
    expect(spend?.style).toBe('danger');
    expect(topUp?.text).toBe(COPY.topUpMenu);
    expect(spend?.text).toBe(COPY.expenseMenu);
    expect(
      (bot.last.lastKeyboard ?? []).some(
        (row) =>
          row.some((button) => button.text.includes(COPY.topUpMenu)) &&
          row.some((button) => button.text.includes(COPY.expenseMenu)),
      ),
    ).toBe(true);
    expect((bot.last.lastKeyboard ?? []).flat().some((button) => button.text.includes('Сбер1'))).toBe(
      false,
    );
    expect(bot.last.allTexts()).not.toMatch(/карт/i);
  });

  it('UI-06 / UI-07: проход всех в работе; замороженные не в очереди; одна карта — тот же путь', async () => {
    const bot = new TelegramProbe(db.pool(), '602');
    const userId = await insertUser(db.pool(), '602');
    await createMaterial(bot, 'Альфа', '1000');
    await createMaterial(bot, 'Бета', '2000');
    await createMaterial(bot, 'Гамма', '3000');
    await bot.tapLabel(COPY.expenseMenu);
    await bot.tapLabel('Заблокировать');
    await bot.tapLabel('Гамма');
    await bot.tapLabel('Обновить балансы');
    expect(bot.last.lastText).toContain('Альфа');
    expect(bot.last.lastText).toContain('1 из 2');
    expect(bot.last.lastText).not.toContain('Гамма');
    await bot.send('1100');
    expect(bot.last.lastText).toContain('Бета');
    expect(bot.last.lastText).toContain('2 из 2');
    await bot.send('/start');
    const rows = await withUser(db.pool(), userId, async (client) => {
      const result = await client.query<{ name: string; amount: string; source: string }>(
        `SELECT c.name, b.amount::text AS amount, b.source
         FROM v_current_balance_entries b
         JOIN cards c ON c.id = b.card_id
         WHERE b.user_id = $1 AND b.effective_date = '2024-08-20'`,
        [userId],
      );
      return result.rows;
    });
    expect(rows.some((row) => row.name === 'Альфа' && row.amount === '1100.00')).toBe(true);
    expect(rows.some((row) => row.name === 'Бета' && row.amount === '2000.00')).toBe(true);

    await bot.send('/start');
    await bot.tapLabel('Обновить балансы');
    expect(bot.last.lastText).toContain('Введите текущий баланс');
    expect(bot.last.lastKeyboard?.flat().some((button) => button.text.includes('Пропустить'))).toBe(true);
  });

  it('UI-08: архивирование — ноль, вывод, перевод, потеря', async () => {
    async function seed(telegramId: string, remainder: string) {
      const bot = new TelegramProbe(db.pool(), telegramId);
      await insertUser(db.pool(), telegramId);
      await createMaterial(bot, 'Источник', remainder);
      await createMaterial(bot, 'Получатель', '1000');
      await bot.tapLabel('Настройки');
      await bot.tapLabel('Удалить материал');
      await bot.tapLabel('Источник');
      await bot.tapLabel('Да');
      return bot;
    }

    const zero = await seed('6080', '0');
    expect(zero.last.allTexts()).toContain(COPY.archivedDone);

    const withdrawn = await seed('6081', '20000');
    expect(withdrawn.last.allTexts()).toContain('Что стало с этими деньгами');
    await withdrawn.tapLabel('Вывел');
    expect(withdrawn.last.allTexts()).toContain(COPY.archivedDone);

    const lost = await seed('6082', '20000');
    await lost.tapLabel('Потерял');
    expect(lost.last.allTexts()).toContain(COPY.archivedDone);

    const transferred = await seed('6083', '20000');
    await transferred.tapLabel('Перевёл');
    await transferred.tapLabel('Получатель');
    expect(transferred.last.allTexts()).toContain(COPY.archivedDone);
  });

  it('UI-09: устаревший rev не меняет данные', async () => {
    const bot = new TelegramProbe(db.pool(), '609');
    const userId = await insertUser(db.pool(), '609');
    await createMaterial(bot, 'Сбер', '5000');
    const stale = encodeCallback('upd_all', null, 0);
    await bot.tapLabel('Обновить балансы');
    await bot.tap(stale);
    expect(bot.last.allTexts()).toContain(COPY.stale);
    const count = await withUser(db.pool(), userId, async (client) => {
      const result = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM balance_entries WHERE user_id = $1`,
        [userId],
      );
      return result.rows[0]?.n;
    });
    expect(count).toBe('1');
  });

  it('UI-10: повторный update_id не создаёт вторую запись', async () => {
    const bot = new TelegramProbe(db.pool(), '610');
    const userId = await insertUser(db.pool(), '610');
    await createMaterial(bot, 'Сбер', '1000');
    await bot.tapLabel('Обновить балансы');
    const firstId = bot.updateId;
    await bot.send('1500', firstId);
    await bot.send('9999', firstId);
    const amounts = await withUser(db.pool(), userId, async (client) => {
      const result = await client.query<{ amount: string }>(
        `SELECT amount::text AS amount FROM v_current_balance_entries WHERE user_id = $1`,
        [userId],
      );
      return result.rows.map((row) => row.amount);
    });
    expect(amounts).toEqual(['1500.00']);
  });

  it('UI-11 / UI-16: чужой card_id — «не найден», ноль изменений', async () => {
    const owner = new TelegramProbe(db.pool(), '6111');
    const ownerId = await insertUser(db.pool(), '6111');
    await createMaterial(owner, 'Чужой', '8000');
    const ownerCardId = await firstCardId(db.pool(), ownerId);

    const stranger = new TelegramProbe(db.pool(), '6112');
    const strangerId = await insertUser(db.pool(), '6112');
    await createMaterial(stranger, 'Свой', '100');
    const rev = currentRev(stranger);
    const forged = encodeCallback('upd_one', ownerCardId, rev);
    const before = await countBalances(db.pool(), strangerId);
    await stranger.tap(forged);
    expect(stranger.last.allTexts()).toContain(COPY.notFound);
    expect(await countBalances(db.pool(), strangerId)).toBe(before);

    const freezeForged = encodeCallback('freeze', ownerCardId, rev);
    await stranger.tap(freezeForged);
    expect(stranger.last.allTexts()).toContain(COPY.notFound);
  });

  it('UI-12 через интерфейс: мусор не продвигает очередь', async () => {
    const bot = new TelegramProbe(db.pool(), '612');
    await insertUser(db.pool(), '612');
    await createMaterial(bot, 'Альфа', '1000');
    await createMaterial(bot, 'Бета', '2000');
    await bot.tapLabel('Обновить балансы');
    expect(bot.last.lastText).toContain('1 из 2');
    await bot.send('10.999');
    expect(bot.last.lastText).toContain('Копейки — не более двух знаков');
    await bot.send('1100');
    expect(bot.last.lastText).toContain('2 из 2');
  });

  it('UI-13: businessDate не меняется после полуночи (C-11)', async () => {
    let now = new Date('2024-08-31T23:59:00+03:00');
    const bot = new TelegramProbe(db.pool(), '613', () => now);
    const userId = await insertUser(db.pool(), '613');
    await createMaterial(bot, 'Сбер', '1000');
    await bot.tapLabel('Обновить балансы');
    now = new Date('2024-09-01T00:01:00+03:00');
    await bot.send('1500');
    const dates = await withUser(db.pool(), userId, async (client) => {
      const result = await client.query<{ d: string; amount: string }>(
        `SELECT effective_date::text AS d, amount::text AS amount
         FROM v_current_balance_entries WHERE user_id = $1`,
        [userId],
      );
      return result.rows;
    });
    expect(dates).toEqual([{ d: '2024-08-31', amount: '1500.00' }]);
  });

  it('UI-15: пополнение Y > текущего; Y ≤ не продвигает', async () => {
    const bot = new TelegramProbe(db.pool(), '615');
    const userId = await insertUser(db.pool(), '615');
    await createMaterial(bot, 'Сбер1', '80000');
    await bot.tapLabel(COPY.topUpMenu);
    await bot.tapLabel('Пополнить материал');
    await bot.tapLabel('Сбер1');
    await bot.send('80000');
    expect(bot.last.lastText).toContain('больше текущего');
    await bot.send('90000');
    expect(bot.last.allTexts()).toContain('Пополнено');
    expect(bot.last.allTexts()).toContain('Прибыль не изменилась');
    const row = await withUser(db.pool(), userId, async (client) => {
      const result = await client.query<{ amount: string; capital_in: string }>(
        `SELECT amount::text, capital_in::text FROM v_current_balance_entries WHERE user_id = $1`,
        [userId],
      );
      return result.rows[0];
    });
    expect(row?.amount).toBe('90000.00');
    expect(row?.capital_in).toBe('90000.00');
  });

  it('UI-16: заморозка и разморозка; капитал на месте', async () => {
    const bot = new TelegramProbe(db.pool(), '616');
    await insertUser(db.pool(), '616');
    await createMaterial(bot, 'Альфа', '318861');
    await bot.tapLabel(COPY.expenseMenu);
    await bot.tapLabel('Заблокировать');
    await bot.tapLabel('Альфа');
    expect(bot.last.allTexts()).toContain('заморожен');
    expect(bot.last.allTexts()).toContain(COPY.frozenHeader);
    await bot.tapLabel(COPY.expenseMenu);
    await bot.tapLabel('Вернуть в оборот');
    await bot.tapLabel('Альфа');
    await bot.tapLabel('Вернуть в оборот');
    expect(bot.last.allTexts()).toContain('в работе');
  });

  it('UI-17: трата уменьшает баланс и не архивирует', async () => {
    const bot = new TelegramProbe(db.pool(), '617');
    const userId = await insertUser(db.pool(), '617');
    await createMaterial(bot, 'Сбер1', '80000');
    await bot.tapLabel(COPY.expenseMenu);
    await bot.tapLabel('Потратил');
    await bot.tapLabel('Сбер1');
    await bot.send('80000');
    expect(bot.last.lastText).toContain('меньше текущего');
    await bot.send('70000');
    expect(bot.last.allTexts()).toContain('Выведено');
    const row = await withUser(db.pool(), userId, async (client) => {
      const result = await client.query<{ amount: string; archived: string | null }>(
        `SELECT b.amount::text AS amount, c.archived_on::text AS archived
         FROM v_current_balance_entries b
         JOIN cards c ON c.id = b.card_id
         WHERE b.user_id = $1`,
        [userId],
      );
      return result.rows[0];
    });
    expect(row?.amount).toBe('70000.00');
    expect(row?.archived).toBeNull();
  });

  it('Назад из списков расхода и пополнения возвращает в меню', async () => {
    const bot = new TelegramProbe(db.pool(), '618');
    await insertUser(db.pool(), '618');
    await createMaterial(bot, 'Альфа', '1000');

    await bot.tapLabel(COPY.expenseMenu);
    await bot.tapLabel('Заблокировать');
    expect(bot.last.lastText).toContain(COPY.freezeWhich);
    await bot.tapLabel('Назад');
    expect(bot.last.lastText).toBe(COPY.expenseMenu);

    await bot.tapLabel('Вернуть в оборот');
    expect(bot.last.lastText).toBe(COPY.noFrozen);
    await bot.tapLabel('Назад');
    expect(bot.last.lastText).toBe(COPY.expenseMenu);

    await bot.send('/start');
    await bot.tapLabel(COPY.topUpMenu);
    await bot.tapLabel('Пополнить материал');
    expect(bot.last.lastText).toContain(COPY.pickMaterial);
    await bot.tapLabel('Назад');
    expect(bot.last.lastText).toBe(COPY.topUpMenu);
  });

  it('нет выбора стикера и переименования; банк определяется по названию', async () => {
    const bot = new TelegramProbe(db.pool(), '619');
    await insertUser(db.pool(), '619');
    await createMaterial(bot, 'Втб2312', '10000');
    expect(bot.last.allTexts()).toContain('Втб2312');
    expect(bot.last.allTexts()).not.toMatch(/^\d+\) /m);
    expect(bot.last.allTexts()).toContain(CUSTOM_EMOJI_ID.vtb);
    expect(bot.last.messages.at(-1)?.parseMode).toBe('HTML');
    expect(bot.last.allTexts()).not.toContain('Выберите стикер');
    expect(bot.last.allTexts()).not.toContain('Без стикера');
    await bot.tapLabel(COPY.topUpMenu);
    await bot.tapLabel('Пополнить материал');
    const picker = (bot.last.lastKeyboard ?? []).flat().map((button) => button.text).join('\n');
    expect(picker).toContain('🔵 Втб2312');
    await bot.tapLabel('Назад');
    await bot.tapLabel('Назад');
    await bot.tapLabel('Настройки');
    const settings = (bot.last.lastKeyboard ?? []).flat().map((button) => button.text).join('\n');
    expect(settings).not.toContain('Переименовать');
    expect(settings).not.toContain('стикер');
    expect(settings).toContain('Отчёт в Excel');
  });

  it('обновление баланса вверх и вниз меняет прибыль, не депозит', async () => {
    const bot = new TelegramProbe(db.pool(), '620');
    const userId = await insertUser(db.pool(), '620');
    await createMaterial(bot, 'Сбер1', '10000');
    expect(bot.last.allTexts()).toContain(COPY.totalHeader);
    expect(bot.last.allTexts()).not.toMatch(/<b>В работе:<\/b> /);

    await bot.tapLabel('Обновить балансы');
    await bot.send('15000');
    expect(bot.last.allTexts()).toContain(`+5${'\u202F'}000 ₽`);
    expect(bot.last.allTexts()).toContain(COPY.totalHeader);
    expect(bot.last.allTexts()).not.toMatch(/Обновлено \d+/);
    expect(bot.last.messages.at(-1)?.parseMode).toBe('HTML');

    const afterUp = await withUser(db.pool(), userId, async (client) => {
      const result = await client.query<{ amount: string; capital_in: string }>(
        `SELECT amount::text, capital_in::text FROM v_current_balance_entries WHERE user_id = $1`,
        [userId],
      );
      return result.rows[0];
    });
    expect(afterUp?.amount).toBe('15000.00');
    expect(afterUp?.capital_in).toBe('10000.00');

    await bot.send('/start');
    await bot.tapLabel('Обновить балансы');
    await bot.send('12000');
    expect(bot.last.allTexts()).toContain(`+2${'\u202F'}000 ₽`);

    const afterDown = await withUser(db.pool(), userId, async (client) => {
      const result = await client.query<{ amount: string; capital_in: string }>(
        `SELECT amount::text, capital_in::text FROM v_current_balance_entries WHERE user_id = $1`,
        [userId],
      );
      return result.rows[0];
    });
    expect(afterDown?.amount).toBe('12000.00');
    expect(afterDown?.capital_in).toBe('10000.00');
  });
});

function firstCardId(pool: import('pg').Pool, userId: string): Promise<string> {
  return withUser(pool, userId, async (client) => {
    const result = await client.query<{ id: string }>(
      'SELECT id::text AS id FROM cards WHERE user_id = $1 ORDER BY id LIMIT 1',
      [userId],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error('card id not found');
    }
    return id;
  });
}

function currentRev(bot: TelegramProbe): number {
  const first = bot.last.lastKeyboard?.[0]?.[0]?.data;
  if (first === undefined) {
    return 0;
  }
  const parsed = parseCallbackData(first);
  return parsed.ok ? parsed.rev : 0;
}

async function countBalances(pool: import('pg').Pool, userId: string): Promise<number> {
  return withUser(pool, userId, async (client) => {
    const result = await client.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM balance_entries WHERE user_id = $1',
      [userId],
    );
    return Number(result.rows[0]?.n ?? '0');
  });
}
