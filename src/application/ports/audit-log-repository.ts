import type { CardId, UserId } from '../../domain/cards/card.js';

import type { DbTx } from './unit-of-work.js';

export type AuditAction = 'CARD_FREEZE' | 'CARD_UNFREEZE' | 'CARD_ARCHIVE';

/**
 * Запись в `audit_log`. В payload нет денежных сумм.
 *
 * @see docs/database.md §3.7
 */
export type AuditEventInput = {
  action: AuditAction;
  entity: 'card';
  entityId: CardId;
  payload: Record<string, string>;
};

export interface AuditLogRepository {
  appendUserEvent(userId: UserId, event: AuditEventInput, tx: DbTx): Promise<void>;
}
