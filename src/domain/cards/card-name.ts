/**
 * Нормализация названия карты — то же правило, что у генерируемого
 * `cards.name_norm`: `lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))`.
 *
 * POSIX `\s` = `[\t\n\v\f\r ]`, не JS Unicode `\s` (иначе уникальность
 * в коде и частичный индекс в БД разойдутся, C-6).
 *
 * @see docs/database.md §3.3
 * @see docs/requirements.md C-6
 */
const POSIX_WHITESPACE = /[\t\n\v\f\r ]+/g;

export function normalizeCardName(name: string): string {
  return name.replace(POSIX_WHITESPACE, ' ').replace(/^ +| +$/g, '').toLowerCase();
}
