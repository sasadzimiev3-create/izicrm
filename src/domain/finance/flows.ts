import type { Card } from '../cards/card.js';
import { ValidationError } from '../errors.js';
import { Money } from '../money/money.js';
import {
  balanceAsOf,
  entriesInClosedRange,
  indexLedger,
  type BalanceEntry,
  type Ledger,
} from './balance.js';
import { compareDates, type BusinessDate } from './period.js';

/**
 * `Deposit(c, D) = I(c, D)`, если запись на дату есть, иначе 0.
 *
 * @see docs/financial-model.md §4.1
 */
export function capitalInOf(entry: BalanceEntry | undefined): Money {
  return entry === undefined ? Money.zero() : entry.capitalIn;
}

/**
 * Вывод при архивировании:
 * `B(c, archived_on)` при `reason = WITHDRAWN`, иначе 0.
 * `TRANSFERRED` и `LOST` потока не создают (C-3, C-17).
 *
 * Дата потока = `archived_on(c)`.
 *
 * @see docs/financial-model.md §4.2
 */
export function deriveWithdrawal(ledger: Ledger, card: Card): Money {
  if (card.archivedOn === null || card.archiveReason !== 'WITHDRAWN') {
    return Money.zero();
  }
  return balanceAsOf(ledger, card.id, card.archivedOn) ?? Money.zero();
}

/**
 * `NetDeposits(u, [A, B]) = Σ I(c, d)` по актуальным записям с A ≤ d ≤ B.
 *
 * @see docs/financial-model.md §4.1
 */
export function netDeposits(ledger: Ledger, from: BusinessDate, to: BusinessDate): Money {
  let total = Money.zero();
  for (const entry of entriesInClosedRange(ledger, from, to)) {
    total = total.plus(entry.capitalIn);
  }
  return total;
}

/**
 * Сумма выводов `WITHDRAWN` с `archived_on ∈ [A, B]`.
 *
 * @see docs/financial-model.md §4.2, §5.4
 */
export function totalArchiveWithdrawals(
  ledger: Ledger,
  from: BusinessDate,
  to: BusinessDate,
): Money {
  const indexed = indexLedger(ledger);
  let total = Money.zero();
  for (const card of indexed.cards) {
    if (card.archivedOn === null || !inClosedRange(card.archivedOn, from, to)) {
      continue;
    }
    total = total.plus(deriveWithdrawal(indexed, card));
  }
  return total;
}

/**
 * Чистый внешний поток за период:
 * `NetFlow(u, [A, B]) = Σ I − Σ O − Σ Withdrawal(c) · ⟦A ≤ archived_on ≤ B⟧`
 *
 * Знак: ввод положителен, вывод отрицателен.
 *
 * @see docs/financial-model.md §4.3
 */
export function netFlow(ledger: Ledger, from: BusinessDate, to: BusinessDate): Money {
  const indexed = indexLedger(ledger);
  let flow = Money.zero();
  for (const entry of entriesInClosedRange(indexed, from, to)) {
    flow = flow.plus(entry.capitalIn).minus(entry.capitalOut);
  }
  for (const card of indexed.cards) {
    if (card.archivedOn === null || !inClosedRange(card.archivedOn, from, to)) {
      continue;
    }
    flow = flow.minus(deriveWithdrawal(indexed, card));
  }
  return flow;
}

export type SignedFlow = {
  date: BusinessDate;
  amount: Money;
};

/**
 * Знаковые потоки периода для Modified Dietz: депозиты `+I`, траты `−O`,
 * выводы `WITHDRAWN` как `−Withdrawal`. Нулевые суммы отбрасываются.
 */
export function signedFlows(ledger: Ledger, from: BusinessDate, to: BusinessDate): SignedFlow[] {
  const indexed = indexLedger(ledger);
  const flows: SignedFlow[] = [];
  for (const entry of entriesInClosedRange(indexed, from, to)) {
    if (!entry.capitalIn.isZero()) {
      flows.push({ date: entry.effectiveDate, amount: entry.capitalIn });
    }
    if (!entry.capitalOut.isZero()) {
      flows.push({ date: entry.effectiveDate, amount: entry.capitalOut.negated() });
    }
  }
  for (const card of indexed.cards) {
    if (card.archivedOn === null || !inClosedRange(card.archivedOn, from, to)) {
      continue;
    }
    const withdrawal = deriveWithdrawal(indexed, card);
    if (!withdrawal.isZero()) {
      flows.push({ date: card.archivedOn, amount: withdrawal.negated() });
    }
  }
  return flows;
}

/**
 * Δ пополнения: `Y − текущий`, только при `Y > текущий` (C-26, FT-28).
 */
export function topUpDelta(current: Money, next: Money): Money {
  const delta = next.minus(current);
  if (!delta.isPositive()) {
    throw new ValidationError('Новый баланс должен быть больше текущего');
  }
  return delta;
}

/**
 * Δ траты: `текущий − Y`, только при `Y < текущий` (C-30, FR-9.4).
 */
export function spendDelta(current: Money, next: Money): Money {
  const delta = current.minus(next);
  if (!delta.isPositive()) {
    throw new ValidationError('Новый баланс должен быть меньше текущего');
  }
  return delta;
}

function inClosedRange(date: BusinessDate, from: BusinessDate, to: BusinessDate): boolean {
  return compareDates(date, from) >= 0 && compareDates(date, to) <= 0;
}
