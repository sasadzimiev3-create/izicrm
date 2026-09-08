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

export type DialogStateRepository = {
  getUserDialogState(userId: UserId, tx: DbTx): Promise<DialogStateRecord | null>;
  /**
   * Сравнивает и увеличивает `state_rev`. Второй запрос с тем же rev получает `stale`.
   * Нет строки диалога — `missing` (первый визит, проверять нечего).
   */
  consumeUserDialogRev(
    userId: UserId,
    expectedRev: number,
    tx: DbTx,
  ): Promise<'missing' | 'stale' | number>;
  /**
   * Возвращает ревизию после сбоя операции, чтобы повтор того же callback снова прошёл CAS.
   * Срабатывает только если текущая ревизия всё ещё `fromRev` (мы её только что заняли).
   */
  restoreUserDialogRev(
    userId: UserId,
    fromRev: number,
    toRev: number,
    tx: DbTx,
  ): Promise<void>;
  upsertUserDialogState(
    userId: UserId,
    input: UpsertDialogStateInput,
    tx: DbTx,
  ): Promise<DialogStateRecord>;
  clearUserDialogState(userId: UserId, tx: DbTx): Promise<void>;
};
