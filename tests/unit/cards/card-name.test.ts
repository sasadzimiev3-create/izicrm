import { describe, expect, it } from 'vitest';

import { normalizeCardName } from '../../../src/domain/cards/card-name.js';
import { cardId, userId } from '../../../src/domain/cards/card.js';

describe('normalizeCardName', () => {
  it('совпадает с cards.name_norm: lower(btrim(regexp_replace(..., \\s+, space)))', () => {
    expect(normalizeCardName('Сбер1')).toBe('сбер1');
    expect(normalizeCardName('сбер1')).toBe('сбер1');
    expect(normalizeCardName('Сбер1 ')).toBe('сбер1');
    expect(normalizeCardName(' Сбер1')).toBe('сбер1');
    expect(normalizeCardName('  Сбер  1  ')).toBe('сбер 1');
    expect(normalizeCardName('Сбер\t1')).toBe('сбер 1');
    expect(normalizeCardName('Сбер\n1')).toBe('сбер 1');
    expect(normalizeCardName('Сбер\r1')).toBe('сбер 1');
    expect(normalizeCardName('Сбер\f1')).toBe('сбер 1');
    expect(normalizeCardName('Сбер\v1')).toBe('сбер 1');
    expect(normalizeCardName('АЛЬФА')).toBe('альфа');
  });

  it('не использует Unicode \\s: NBSP не сжимается (как POSIX в PostgreSQL)', () => {
    expect(normalizeCardName('Сбер\u00A01')).toBe('сбер\u00A01');
  });

  it('пустая строка и одни пробелы → пусто', () => {
    expect(normalizeCardName('')).toBe('');
    expect(normalizeCardName('   ')).toBe('');
  });
});

describe('идентификаторы карты', () => {
  it('branded-конструкторы сохраняют значение', () => {
    expect(cardId(7)).toBe(7);
    expect(userId(3)).toBe(3);
  });
});
