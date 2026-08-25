import type { UserId } from '../../domain/cards/card.js';
import type { BusinessDate } from '../../domain/finance/period.js';

import type { DbTx } from './unit-of-work.js';

export type DialogStateRecord = {
  userId: UserId;
  state: string;
  payload: Record<string, unknown>;
  businessDate: BusinessDate | null;
  stateRev: number;
  expiresAt: Date;
};

export type UpsertDialogStateInput = {
  state: string;
  payload: Record<string, unknown>;
  businessDate: BusinessDate | null;
  expiresAt: Date;
};

export interface DialogStateRepository {
  getUserDialogState(userId: UserId, tx: DbTx): Promise<DialogStateRecord | null>;
  upsertUserDialogState(
    userId: UserId,
    input: UpsertDialogStateInput,
    tx: DbTx,
  ): Promise<DialogStateRecord>;
  clearUserDialogState(userId: UserId, tx: DbTx): Promise<void>;
}
