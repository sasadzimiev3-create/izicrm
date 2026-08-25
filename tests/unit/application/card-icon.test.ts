import { describe, expect, it } from 'vitest';

import { assertCardIcon, CARD_ICONS, isAllowedCardIcon } from '../../../src/application/dto/card-icon.js';
import { ValidationError } from '../../../src/domain/errors.js';

describe('белый список стикеров (C-20)', () => {
  it('принимает каждый эмодзи из списка и null', () => {
    for (const icon of CARD_ICONS) {
      expect(isAllowedCardIcon(icon)).toBe(true);
      expect(assertCardIcon(icon)).toBe(icon);
    }
    expect(assertCardIcon(null)).toBeNull();
  });

  it('принимает ⚪ с вариационным селектором VS16', () => {
    expect(assertCardIcon('⚪\uFE0F')).toBe('⚪');
  });

  it('отклоняет произвольный текст до записи в базу', () => {
    expect(() => assertCardIcon('abc')).toThrow(ValidationError);
    expect(() => assertCardIcon('💳')).toThrow(ValidationError);
    expect(() => assertCardIcon('🟢 extra')).toThrow(ValidationError);
    expect(() => assertCardIcon('')).toThrow(ValidationError);
  });
});
