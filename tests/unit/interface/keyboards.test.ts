import { describe, expect, it } from 'vitest';

import { dashboardKeyboard, mainKeyboard, settingsKeyboard } from '../../../src/interface/telegram/keyboards/keyboards.js';
import { cardId } from '../../../src/domain/cards/card.js';
import { Money } from '../../../src/domain/money/money.js';

describe('главное меню', () => {
  it('добавить и вывел в одном ряду, без кнопок материалов и без стикеров на кнопках', () => {
    const rows = mainKeyboard(1);
    expect(rows.map((row) => row.map((button) => button.text))).toEqual([
      ['🔄 Обновить балансы'],
      ['Добавить', 'Вывел'],
      ['⚙️ Настройки'],
    ]);
    const add = rows[1]?.[0];
    const spend = rows[1]?.[1];
    expect(add !== undefined && 'data' in add ? add.style : undefined).toBe('success');
    expect(spend !== undefined && 'data' in spend ? spend.style : undefined).toBe('danger');
    const dash = dashboardKeyboard(1, {
      working: [{ id: cardId(1), name: 'Сбер1', balance: Money.from('100') }],
      frozen: [{ id: cardId(2), name: 'Альфа', balance: Money.from('50') }],
    });
    expect(dash.flat().some((button) => button.text.includes('Сбер1'))).toBe(false);
    expect(dash.flat().some((button) => button.text.includes('Альфа'))).toBe(false);
    expect(dash).toEqual(rows);
  });

  it('настройки без переименования и смены стикера', () => {
    const labels = settingsKeyboard(1).flat().map((button) => button.text);
    expect(labels.some((text) => text.includes('Отчёт'))).toBe(true);
    expect(labels.some((text) => /кабинет/i.test(text))).toBe(true);
    expect(labels.some((text) => text.includes('Удалить'))).toBe(true);
    expect(labels.join('\n')).not.toMatch(/Переименовать|стикер/i);
  });
});
