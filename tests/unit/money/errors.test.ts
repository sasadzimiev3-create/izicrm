import { describe, expect, it } from 'vitest';

import {
  ConflictError,
  DomainError,
  NotFoundError,
  StaleCallbackError,
  ValidationError,
} from '../../../src/domain/errors.js';

describe('ошибки домена (architecture.md §6)', () => {
  it('ValidationError — ввод пользователя', () => {
    const error = new ValidationError('Копейки — не более двух знаков');
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ValidationError');
    expect(error.message).toBe('Копейки — не более двух знаков');
  });

  it('ConflictError / NotFoundError / StaleCallbackError', () => {
    expect(new ConflictError('дубль').name).toBe('ConflictError');
    expect(new NotFoundError('Карта не найдена').name).toBe('NotFoundError');
    expect(new StaleCallbackError('Кнопка устарела').name).toBe('StaleCallbackError');
  });
});
