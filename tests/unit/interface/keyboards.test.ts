import { describe, expect, it } from 'vitest';

import { dashboardKeyboard, mainKeyboard } from '../../../src/interface/telegram/keyboards/keyboards.js';
import { cardId } from '../../../src/domain/cards/card.js';
import { Money } from '../../../src/domain/money/money.js';

describe('главное меню', () => {
  it('пополнить и расход в одном ряду, без кнопок материалов', () => {
    const rows = mainKeyboard(1);
    expect(rows.map((row) => row.map((button) => button.text))).toEqual([
      ['🔄 Обновить балансы'],
      ['➕ Пополнить', '❄️ Расход'],
      ['⚙️ Настройки'],
    ]);
    const dash = dashboardKeyboard(1, {
      working: [{ id: cardId(1), name: 'Сбер1', icon: '🟢', balance: Money.from('100') }],
      frozen: [{ id: cardId(2), name: 'Альфа', icon: '🔴', balance: Money.from('50') }],
    });
    expect(dash.flat().some((button) => button.text.includes('Сбер1'))).toBe(false);
    expect(dash.flat().some((button) => button.text.includes('Альфа'))).toBe(false);
    expect(dash).toEqual(rows);
  });
});
