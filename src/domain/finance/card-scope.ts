import type { Card } from '../cards/card.js';
import { compareDates, type BusinessDate } from './period.js';

/**
 * Карта в scope на дату D:
 * `created_on ≤ D ∧ (archived_on = null ∨ D < archived_on)`.
 * В день архивирования карта уже не входит в капитал.
 *
 * @see docs/financial-model.md §3.3
 */
export function isInScope(card: Card, date: BusinessDate): boolean {
  if (compareDates(card.createdOn, date) > 0) {
    return false;
  }
  if (card.archivedOn !== null && compareDates(date, card.archivedOn) >= 0) {
    return false;
  }
  return true;
}

/**
 * Текущий флаг заморозки, не функция от D (C-27: история заморозок не ведётся).
 *
 * `IsFrozen(c) ⇔ frozen_on(c) ≠ null`
 *
 * @see docs/financial-model.md §3.3
 */
export function isFrozen(card: Card): boolean {
  return card.frozenOn !== null;
}

/**
 * `InWorking(c, D) ⇔ InScope(c, D) ∧ ¬IsFrozen(c)`
 *
 * @see docs/financial-model.md §3.3
 */
export function isWorking(card: Card, date: BusinessDate): boolean {
  return isInScope(card, date) && !isFrozen(card);
}
