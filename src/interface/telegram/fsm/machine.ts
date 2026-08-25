import type { DialogStateRecord } from '../../../application/ports/dialog-state-repository.js';
import type { BusinessDate } from '../../../domain/finance/period.js';

import { isDialogExpired } from './guards.js';
import {
  businessDateOf,
  IDLE,
  parseDialogState,
  serializeDialogState,
  type DialogState,
} from './states.js';

export type LoadedDialog = {
  state: DialogState;
  stateRev: number;
  expired: boolean;
  businessDate: BusinessDate | null;
};

export function loadDialog(record: DialogStateRecord | null, now: Date): LoadedDialog {
  if (record === null) {
    return { state: IDLE, stateRev: 0, expired: false, businessDate: null };
  }
  if (isDialogExpired(record.expiresAt, now)) {
    return { state: IDLE, stateRev: record.stateRev, expired: true, businessDate: null };
  }
  const tagged = { t: record.state, ...record.payload };
  const state = parseDialogState(tagged);
  return {
    state,
    stateRev: record.stateRev,
    expired: false,
    businessDate: businessDateOf(state) ?? record.businessDate,
  };
}

export function toUpsert(state: DialogState, expiresAt: Date): {
  state: string;
  payload: Record<string, unknown>;
  businessDate: BusinessDate | null;
  expiresAt: Date;
} {
  const payload = serializeDialogState(state);
  const { t, ...rest } = payload;
  return {
    state: String(t),
    payload: rest,
    businessDate: businessDateOf(state),
    expiresAt,
  };
}
