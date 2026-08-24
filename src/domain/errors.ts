/**
 * Классы ошибок домена. Поведение интерфейса — `docs/architecture.md` §6.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Ввод пользователя. Состояние диалога не меняется, запрос повторяется. */
export class ValidationError extends DomainError {}

/** Конфликт уникальности (дубль имени, `23505`). */
export class ConflictError extends DomainError {}

/** Карта не найдена или принадлежит другому пользователю — одинаковый ответ. */
export class NotFoundError extends DomainError {}

/** Устаревший `callback_data` (не совпал `state_rev`). */
export class StaleCallbackError extends DomainError {}
