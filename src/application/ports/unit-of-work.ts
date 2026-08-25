import type { UserId } from '../../domain/cards/card.js';

/**
 * Непрозрачная транзакция. Реализация — `Transaction<Database>` в infrastructure.
 * Порты не импортируют `pg` / `kysely` (границы слоёв).
 */
export type DbTx = {
  readonly __brand: 'DbTx';
};

/**
 * Единственный способ обратиться к БД (ADR-008).
 * `withUser` открывает транзакцию и выставляет `SET LOCAL app.current_user_id`.
 *
 * @see docs/database.md §5.3
 * @see docs/architecture.md ADR-008
 */
export interface UnitOfWork {
  withUser<T>(userId: UserId, work: (tx: DbTx) => Promise<T>): Promise<T>;
  withTelegramIdentity<T>(telegramId: string, work: (tx: DbTx) => Promise<T>): Promise<T>;
}
