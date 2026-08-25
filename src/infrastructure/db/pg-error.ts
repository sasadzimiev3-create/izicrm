import { ConflictError } from '../../domain/errors.js';

const UNIQUE_VIOLATION = '23505';

function pgCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

export function rethrowUniqueAsConflict(error: unknown): never {
  let current: unknown = error;
  while (current !== undefined && current !== null) {
    if (pgCode(current) === UNIQUE_VIOLATION) {
      throw new ConflictError('Материал с таким названием уже есть');
    }
    if (typeof current === 'object' && 'cause' in current) {
      current = (current as { cause: unknown }).cause;
      continue;
    }
    break;
  }
  throw error;
}
