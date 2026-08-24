import { Money } from '../money/money.js';
import { isFrozen, isInScope, isWorking } from './card-scope.js';
import { balanceAsOf, indexLedger, type Ledger } from './balance.js';
import type { BusinessDate } from './period.js';

/**
 * `Cap(u, D) = Σ B(c, D)` по картам в scope. 0, если ни одна карта не в scope.
 * Суммирование только в `Decimal`, не в SQL.
 *
 * @see docs/financial-model.md §3.4
 */
export function capitalAsOf(ledger: Ledger, date: BusinessDate): Money {
  const indexed = indexLedger(ledger);
  let total = Money.zero();
  for (const card of indexed.cards) {
    if (!isInScope(card, date)) {
      continue;
    }
    total = total.plus(balanceAsOf(indexed, card.id, date) ?? Money.zero());
  }
  return total;
}

/**
 * `WorkCap(u, D) = Σ B(c, D)` по картам в обороте (`InScope ∧ ¬IsFrozen`).
 *
 * @see docs/financial-model.md §3.4
 */
export function workingCapitalAsOf(ledger: Ledger, date: BusinessDate): Money {
  const indexed = indexLedger(ledger);
  let total = Money.zero();
  for (const card of indexed.cards) {
    if (!isWorking(card, date)) {
      continue;
    }
    total = total.plus(balanceAsOf(indexed, card.id, date) ?? Money.zero());
  }
  return total;
}

/**
 * `FrozenCap(u, D) = Σ B(c, D)` по картам в scope с текущим флагом заморозки.
 *
 * @see docs/financial-model.md §3.4
 */
export function frozenCapitalAsOf(ledger: Ledger, date: BusinessDate): Money {
  const indexed = indexLedger(ledger);
  let total = Money.zero();
  for (const card of indexed.cards) {
    if (!isInScope(card, date) || !isFrozen(card)) {
      continue;
    }
    total = total.plus(balanceAsOf(indexed, card.id, date) ?? Money.zero());
  }
  return total;
}
