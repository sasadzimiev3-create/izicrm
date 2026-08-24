import { ValidationError } from '../errors.js';
import { Decimal, Money } from './money.js';

/** Предел ввода и записи: ±10^15. Ёмкость типа больше — см. C-25. */
const INPUT_ABS_MAX = new Decimal('1000000000000000');

const MSG_EMPTY = 'Введите сумму';
const MSG_INVALID = 'Некорректная сумма';
const MSG_DECIMALS = 'Копейки — не более двух знаков';
const MSG_TOO_LARGE = 'Слишком большое значение';

/**
 * Разбирает ввод суммы пользователя в `Money`.
 *
 * Принимаются цифры, пробелы / узкие пробелы / подчёркивания как разряды,
 * `,` или `.` как десятичный разделитель (не более 2 знаков), опциональный
 * ведущий `−`, опциональный `₽`. При одновременном наличии `.` и `,`
 * последний — десятичный (`10.000,50`, `10,000.50`).
 *
 * Отклоняются: выражения, `1e5`, `10k`, `+500`, третий знак после запятой
 * (без округления), значения вне `±10^15`.
 *
 * @see docs/financial-model.md §8
 * @see docs/requirements.md C-10, C-12, C-25
 */
export function parseAmount(raw: string): Money {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new ValidationError(MSG_EMPTY);
  }

  let text = trimmed;
  if (text.endsWith('₽')) {
    text = text.slice(0, -1).trimEnd();
  }
  if (text === '') {
    throw new ValidationError(MSG_INVALID);
  }

  if (text.startsWith('+')) {
    throw new ValidationError(MSG_INVALID);
  }

  let negative = false;
  if (text.startsWith('−') || text.startsWith('-')) {
    negative = true;
    text = text.slice(1).trimStart();
  }
  if (text === '') {
    throw new ValidationError(MSG_INVALID);
  }

  if (/[eE]/.test(text) || /[^\d.,\s_]/.test(text)) {
    throw new ValidationError(MSG_INVALID);
  }

  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  const hasDot = lastDot !== -1;
  const hasComma = lastComma !== -1;

  let intDigits: string;
  let frac = '';

  if (hasDot && hasComma) {
    const decIndex = Math.max(lastDot, lastComma);
    frac = text.slice(decIndex + 1);
    assertFraction(frac);
    const thousandSep = decIndex === lastDot ? ',' : '.';
    intDigits = integerDigits(text.slice(0, decIndex), thousandSep);
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    if (text.indexOf(sep) !== (hasDot ? lastDot : lastComma)) {
      throw new ValidationError(MSG_INVALID);
    }
    const decIndex = hasDot ? lastDot : lastComma;
    frac = text.slice(decIndex + 1);
    assertFraction(frac);
    intDigits = integerDigits(text.slice(0, decIndex), null);
  } else {
    intDigits = integerDigits(text, null);
  }

  const sign = negative ? '-' : '';
  const value = new Decimal(`${sign}${intDigits}.${frac.padEnd(2, '0')}`);
  if (value.abs().greaterThan(INPUT_ABS_MAX)) {
    throw new ValidationError(MSG_TOO_LARGE);
  }

  return Money.from(value.toFixed(2));
}

function assertFraction(frac: string): void {
  if (frac.length === 0 || !/^\d+$/.test(frac)) {
    throw new ValidationError(MSG_INVALID);
  }
  if (frac.length > 2) {
    throw new ValidationError(MSG_DECIMALS);
  }
}

function integerDigits(intRaw: string, extraThousandSep: '.' | ',' | null): string {
  if (intRaw === '') {
    throw new ValidationError(MSG_INVALID);
  }

  const allowed =
    extraThousandSep === null
      ? /^[\d\s_]+$/
      : extraThousandSep === '.'
        ? /^[\d\s_.]+$/
        : /^[\d\s_,]+$/;

  if (!allowed.test(intRaw)) {
    throw new ValidationError(MSG_INVALID);
  }

  const digits = intRaw.replace(/[\s_.,]/g, '');
  if (digits === '' || !/^\d+$/.test(digits)) {
    throw new ValidationError(MSG_INVALID);
  }
  return digits;
}
