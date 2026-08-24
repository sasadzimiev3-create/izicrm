import { Decimal, Money } from './money.js';

/**
 * Размеченный результат процента: неопределённое значение нельзя прочитать как число.
 *
 * @see docs/financial-model.md §5.1, docs/requirements.md C-2
 */
export type PercentResult =
  | { defined: true; value: Decimal }
  | { defined: false; reason: 'ZERO_BASE' | 'NEGATIVE_BASE' | 'NO_PREVIOUS_DATA' };

/**
 * Простая доходность: `Return = delta / base × 100`, если `base > 0`.
 * При `base = 0` — `ZERO_BASE`, при `base < 0` — `NEGATIVE_BASE`.
 * Промежуточное значение не округляется; 2 знака — только при отображении.
 *
 * @see docs/financial-model.md §5.1, §8
 */
export function percentChange(delta: Money, base: Money): PercentResult {
  if (base.isZero()) {
    return { defined: false, reason: 'ZERO_BASE' };
  }
  if (base.isNegative()) {
    return { defined: false, reason: 'NEGATIVE_BASE' };
  }
  return {
    defined: true,
    value: delta.toDecimal().div(base.toDecimal()).mul(100),
  };
}
