import type { UserId } from '../../domain/cards/card.js';

import type { DbTx } from './unit-of-work.js';

/**
 * Идемпотентность доставки (ADR-009). Повтор с тем же `update_id`
 * не создаёт вторую финансовую запись.
 *
 * @see docs/architecture.md ADR-009
 * @see docs/database.md §3.6
 */
export interface ProcessedUpdateRepository {
  /**
   * Пытается занять ключ. `true` — ключ новый (или незавершённый pending), операцию нужно выполнить.
   * `false` — ключ уже обработан, повторно писать нельзя.
   */
  claim(userId: UserId, updateId: string, tx: DbTx, pending?: boolean): Promise<boolean>;
  /** Помечает pending-ключ завершённым. Повторная доставка после этого игнорируется. */
  complete(userId: UserId, updateId: string, tx: DbTx): Promise<void>;
}
