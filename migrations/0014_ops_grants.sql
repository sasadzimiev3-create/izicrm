-- Up Migration

-- Health-check и проверка на старте читают pgmigrations под izicrm_app
-- (`docs/database.md` §8, `docs/architecture.md` §7). Таблица служебная,
-- финансовых данных в ней нет.

GRANT SELECT ON TABLE pgmigrations TO izicrm_app;
GRANT SELECT ON TABLE pgmigrations TO izicrm_migrator;

-- Down Migration

REVOKE SELECT ON TABLE pgmigrations FROM izicrm_migrator;
REVOKE SELECT ON TABLE pgmigrations FROM izicrm_app;
