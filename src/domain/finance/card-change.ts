import type { Card } from '../cards/card.js';
import { percentChange, type PercentResult } from '../money/percent.js';
import { Money } from '../money/money.js';
import { balanceAsOf, indexLedger, previousUpdateDate, type Ledger } from './balance.js';
import { isInScope } from './card-scope.js';
import type { BusinessDate } from './period.js';

/**
 * Изменение баланса карты — информационная метрика, не прибыль.
 * Имя `profit` запрещено: при переводе между своими картами это движение, не результат.
 *
 * ```
 * CardChange(c, D) = B(c, D) − B(c, prev(u, D))   если InScope(c, prev)
 *                  = не определено («новая карта»)  иначе
 * ```
 *
 * База — `prev` пользователя, не последнее обновление самой карты.
 *
 * @see docs/financial-model.md §5.6
 */
export type CardBalanceChange =
  | { defined: true; amount: Money; percent: PercentResult }
  | { defined: false; reason: 'NEW_CARD' | 'NO_PREVIOUS_DATA' | 'NOT_IN_SCOPE' };

export function cardBalanceChange(
  ledger: Ledger,
  card: Card,
  date: BusinessDate,
): CardBalanceChange {
  const indexed = indexLedger(ledger);
  const prev = previousUpdateDate(indexed, date);
  if (prev === undefined) {
    return { defined: false, reason: 'NO_PREVIOUS_DATA' };
  }
  if (!isInScope(card, date)) {
    return { defined: false, reason: 'NOT_IN_SCOPE' };
  }
  if (!isInScope(card, prev)) {
    return { defined: false, reason: 'NEW_CARD' };
  }
  const current = balanceAsOf(indexed, card.id, date) ?? Money.zero();
  const previous = balanceAsOf(indexed, card.id, prev) ?? Money.zero();
  const amount = current.minus(previous);
  return {
    defined: true,
    amount,
    percent: percentChange(amount, previous),
  };
}
