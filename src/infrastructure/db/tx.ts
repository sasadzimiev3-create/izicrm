import type { Transaction } from 'kysely';

import type { DbTx } from '../../application/ports/unit-of-work.js';

import type { Database } from './types.js';

export function kyselyTx(tx: DbTx): Transaction<Database> {
  return tx as unknown as Transaction<Database>;
}

export function asDbTx(trx: Transaction<Database>): DbTx {
  return trx as unknown as DbTx;
}
