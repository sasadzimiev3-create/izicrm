import { describe, expect, it } from 'vitest';

import { loadEnv, parseAdminTelegramIds } from '../../../src/config/env.js';

describe('ADMIN_TELEGRAM_IDS', () => {
  it('пустая строка — никто не админ', () => {
    expect(parseAdminTelegramIds(undefined)).toEqual([]);
    expect(parseAdminTelegramIds('')).toEqual([]);
  });

  it('разбирает список строками и убирает дубли', () => {
    expect(parseAdminTelegramIds('8069167166, 432654986,8069167166')).toEqual([
      '8069167166',
      '432654986',
    ]);
  });

  it('loadEnv кладёт разобранный список', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://izicrm_app:x@localhost:5432/izicrm',
      DATABASE_MIGRATOR_URL: 'postgres://izicrm_migrator:x@localhost:5432/izicrm',
      DATABASE_MAINTENANCE_URL: 'postgres://izicrm_maintenance:x@localhost:5432/izicrm',
      ADMIN_TELEGRAM_IDS: '8069167166,432654986',
    });
    expect(env.ADMIN_TELEGRAM_IDS).toEqual(['8069167166', '432654986']);
  });
});
