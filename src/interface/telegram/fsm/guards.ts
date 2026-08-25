import { StaleCallbackError } from '../../../domain/errors.js';

/** Несовпадение `state_rev` из callback и текущей ревизии. */
export function assertFreshRev(currentRev: number, callbackRev: number): void {
  if (currentRev !== callbackRev) {
    throw new StaleCallbackError('Кнопка устарела');
  }
}

export const DIALOG_TTL_MS = 30 * 60 * 1000;

export function isDialogExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function dialogExpiresAt(now: Date): Date {
  return new Date(now.getTime() + DIALOG_TTL_MS);
}
