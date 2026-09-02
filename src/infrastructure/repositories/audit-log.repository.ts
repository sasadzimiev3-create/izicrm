import type { AuditEventInput, AuditLogRepository } from '../../application/ports/audit-log-repository.js';
import type { DbTx } from '../../application/ports/unit-of-work.js';
import type { UserId } from '../../domain/cards/card.js';
import { cardIdParam, userIdParam } from '../db/ids.js';
import { kyselyTx } from '../db/tx.js';

export class PgAuditLogRepository implements AuditLogRepository {
  async appendUserEvent(userId: UserId, event: AuditEventInput, tx: DbTx): Promise<void> {
    await kyselyTx(tx)
      .insertInto('audit_log')
      .values({
        user_id: userIdParam(userId),
        action: event.action,
        entity: event.entity,
        entity_id: cardIdParam(event.entityId),
        payload: event.payload,
      })
      .execute();
  }
}
