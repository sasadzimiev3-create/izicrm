import { ValidationError } from '../../domain/errors.js';

/**
 * Белый список декоративных стикеров (C-20, FR-2.13).
 * Проверяется в application: в БД только ограничение длины.
 *
 * @see docs/telegram-flows.md §4
 * @see docs/database.md §3.3
 */
export const CARD_ICONS = ['🟢', '🔴', '🔵', '🟡', '🟣', '⚪'] as const;

export type CardIcon = (typeof CARD_ICONS)[number];

const ALLOWED = new Set<string>(CARD_ICONS);

/** iOS часто приписывает VS16 (U+FE0F) к ⚪ — сравниваем без него. */
function stripEmojiVariation(icon: string): string {
  return icon.replaceAll('\uFE0F', '');
}

export function isAllowedCardIcon(icon: string): icon is CardIcon {
  return ALLOWED.has(stripEmojiVariation(icon));
}

/**
 * `null` — шаг пропущен, стикера нет.
 * Произвольный текст отклоняется до записи в базу.
 */
export function assertCardIcon(icon: string | null): string | null {
  if (icon === null) {
    return null;
  }
  const normalized = stripEmojiVariation(icon);
  if (!ALLOWED.has(normalized)) {
    throw new ValidationError('Некорректный стикер');
  }
  return normalized;
}
