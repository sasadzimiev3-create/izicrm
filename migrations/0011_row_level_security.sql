-- Up Migration

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_self ON users
  USING      (telegram_id = NULLIF(current_setting('app.current_telegram_id', true), '')::bigint)
  WITH CHECK (telegram_id = NULLIF(current_setting('app.current_telegram_id', true), '')::bigint);

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::bigint
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cards','balance_entries','dialog_states','audit_log','processed_updates']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (user_id = app_current_user_id())
                               WITH CHECK (user_id = app_current_user_id())',
      t || '_isolation', t);
  END LOOP;
END $$;

-- Down Migration

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cards','balance_entries','dialog_states','audit_log','processed_updates']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_isolation', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS users_self ON users;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE users NO FORCE ROW LEVEL SECURITY;
DROP FUNCTION IF EXISTS app_current_user_id();
