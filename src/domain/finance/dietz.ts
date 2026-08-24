import { Decimal } from '../money/money.js';
import { type PercentResult } from '../money/percent.js';
import { capitalAsOf } from './capital.js';
import { signedFlows } from './flows.js';
import { addDays, daysBetween, type BusinessDate } from './period.js';
import { periodPnl } from './pnl.js';
import { indexLedger, type Ledger } from './balance.js';

/**
 * Modified Dietz за `[A, B]`:
 *
 * ```
 * T   = число дней в [A, B]
 * tᵢ  = номер дня потока i внутри периода, 1-based
 * wᵢ  = (T − tᵢ + 1) / T
 * MDB = Cap(u, A − 1) + Σ wᵢ · Fᵢ
 * MD  = PnL(u, A, B) / MDB × 100    если MDB > 0
 * ```
 *
 * PnL берётся из `periodPnl`, не считается заново.
 *
 * @see docs/financial-model.md §5.5
 */
export function modifiedDietzReturn(
  ledger: Ledger,
  from: BusinessDate,
  to: BusinessDate,
): PercentResult {
  const indexed = indexLedger(ledger);
  const pnl = periodPnl(indexed, from, to);
  const opening = capitalAsOf(indexed, addDays(from, -1));
  const T = daysBetween(from, to) + 1;
  let mdb = opening.toDecimal();
  for (const flow of signedFlows(indexed, from, to)) {
    const t = daysBetween(from, flow.date) + 1;
    const weight = new Decimal(T - t + 1).div(T);
    mdb = mdb.plus(weight.mul(flow.amount.toDecimal()));
  }
  if (mdb.isZero()) {
    return { defined: false, reason: 'ZERO_BASE' };
  }
  if (mdb.isNegative()) {
    return { defined: false, reason: 'NEGATIVE_BASE' };
  }
  return {
    defined: true,
    value: pnl.amount.toDecimal().div(mdb).mul(100),
  };
}
