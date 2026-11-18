import { describe, expect, it } from 'vitest';

import { loadEnv } from '../../../src/config/env.js';

const base = {
  DATABASE_URL: 'postgres://izicrm_app:x@localhost:5432/izicrm',
  DATABASE_MIGRATOR_URL: 'postgres://izicrm_migrator:x@localhost:5432/izicrm',
  DATABASE_MAINTENANCE_URL: 'postgres://izicrm_maintenance:x@localhost:5432/izicrm',
};

describe('WEB_MINIAPP_URL', () => {
  it('пустой адрес выключает Mini App, https сохраняется без хвостового слэша', () => {
    expect(loadEnv(base).WEB_MINIAPP_URL).toBeNull();
    expect(loadEnv({ ...base, WEB_MINIAPP_URL: '' }).WEB_MINIAPP_URL).toBeNull();
    expect(loadEnv({ ...base, WEB_MINIAPP_URL: 'https://31.76.53.4.sslip.io/app/' }).WEB_MINIAPP_URL).toBe(
      'https://31.76.53.4.sslip.io/app',
    );
  });

  it('отклоняет http: Telegram Mini App так не открывается', () => {
    expect(() => loadEnv({ ...base, WEB_MINIAPP_URL: 'http://31.76.53.4:3000/app' })).toThrow(/https/);
  });
});
