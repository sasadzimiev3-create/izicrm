import type { PercentResult } from './percent.js';
import { Decimal, Money } from './money.js';

/** Узкий неразрывный пробел — разделитель разрядов (C-21). */
const NARROW_SPACE = '\u202F';
/** Минус U+2212, не ASCII `-`. */
const MINUS = '\u2212';
/** Отсутствующее значение — em dash (C-2). */
const EM_DASH = '\u2014';

/**
 * Форматирует сумму: узкий пробел U+202F, символ `₽`, копейки опущены при `.00`.
 * Отрицательное значение получает знак `−`. Округление — `ROUND_HALF_UP`, 2 знака.
 *
 * @see docs/financial-model.md §8, docs/requirements.md C-21
 */
export function formatMoney(amount: Money): string {
  return formatRubles(amount, 'negative-only');
}

/**
 * Дельта с явным знаком: `+1 200 ₽`, `−450 ₽`, `+0 ₽`.
 *
 * @see docs/financial-model.md §8
 */
export function formatMoneyDelta(amount: Money): string {
  return formatRubles(amount, 'always');
}

/**
 * Процент: `+1.05%` при определённом значении, `—` если `defined: false`.
 * Невозможно вернуть `0%` для неопределённого результата (C-2).
 * Округление — `ROUND_HALF_UP` до 2 знаков, только здесь.
 *
 * @see docs/financial-model.md §8, docs/requirements.md C-5, C-2
 */
export function formatPercent(result: PercentResult): string {
  if (!result.defined) {
    return EM_DASH;
  }
  const rounded = result.value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (rounded.isZero()) {
    return '0.00%';
  }
  const sign = rounded.isNegative() ? MINUS : '+';
  return `${sign}${rounded.abs().toFixed(2)}%`;
}

/**
 * Доля части в целом (`shareOf`): `61.40%`, без «+».
 * Это не доходность — знак плюса зарезервирован для P&L (`formatPercent`).
 */
export function formatSharePercent(result: PercentResult): string {
  if (!result.defined) {
    return EM_DASH;
  }
  const rounded = result.value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (rounded.isZero()) {
    return '0.00%';
  }
  if (rounded.isNegative()) {
    return `${MINUS}${rounded.abs().toFixed(2)}%`;
  }
  return `${rounded.toFixed(2)}%`;
}

function formatRubles(amount: Money, signMode: 'always' | 'negative-only'): string {
  const fixed = amount.abs().toFixed();
  const [intPart = '0', frac = '00'] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_SPACE);
  const number = frac === '00' ? grouped : `${grouped},${frac}`;
  const body = `${number} ₽`;

  if (signMode === 'always') {
    if (amount.isZero()) {
      return `+${body}`;
    }
    return amount.isNegative() ? `${MINUS}${body}` : `+${body}`;
  }

  if (amount.isZero() || !amount.isNegative()) {
    return body;
  }
  return `${MINUS}${body}`;
}
