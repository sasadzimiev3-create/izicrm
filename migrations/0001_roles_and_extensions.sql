-- Up Migration

-- Роли кластера. Пароли задаёт оператор или тестовый harness (ALTER ROLE),
-- в миграции секретов нет. Первое применение требует CREATEROLE (обычно суперпользователь).
-- Расширения сверх стандартного PostgreSQL 17 не нужны.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'izicrm_migrator') THEN
    CREATE ROLE izicrm_migrator LOGIN
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'izicrm_app') THEN
    CREATE ROLE izicrm_app LOGIN
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'izicrm_maintenance') THEN
    CREATE ROLE izicrm_maintenance LOGIN
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO izicrm_migrator;
GRANT USAGE ON SCHEMA public TO izicrm_app;
GRANT USAGE ON SCHEMA public TO izicrm_maintenance;

ALTER ROLE izicrm_migrator SET search_path = public;
ALTER ROLE izicrm_app SET search_path = public;
ALTER ROLE izicrm_maintenance SET search_path = public;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO izicrm_migrator', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO izicrm_app', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO izicrm_maintenance', current_database());
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database());
END $$;

-- Down Migration

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO PUBLIC', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM izicrm_app', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM izicrm_migrator', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM izicrm_maintenance', current_database());
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

ALTER ROLE IF EXISTS izicrm_app RESET search_path;
ALTER ROLE IF EXISTS izicrm_migrator RESET search_path;
ALTER ROLE IF EXISTS izicrm_maintenance RESET search_path;

DROP OWNED BY izicrm_app;
DROP OWNED BY izicrm_maintenance;
DROP OWNED BY izicrm_migrator;

REVOKE USAGE ON SCHEMA public FROM izicrm_app;
REVOKE USAGE ON SCHEMA public FROM izicrm_maintenance;
REVOKE USAGE, CREATE ON SCHEMA public FROM izicrm_migrator;

GRANT ALL ON SCHEMA public TO PUBLIC;
