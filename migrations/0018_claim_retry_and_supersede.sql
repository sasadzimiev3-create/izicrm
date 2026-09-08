-- Up Migration

-- Повторная доставка апдейта после сбоя: pending-ключ можно занять снова.
-- Ключи сервисов и Telegram — текст, не только numeric update_id.
ALTER TABLE processed_updates
  ALTER COLUMN update_id TYPE TEXT USING update_id::text;

ALTER TABLE processed_updates
  ADD COLUMN completed BOOLEAN NOT NULL DEFAULT TRUE;

-- Вытеснение: после вставки новой строки старая ссылается на её id, не на себя.
CREATE OR REPLACE FUNCTION be_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.amount        IS DISTINCT FROM NEW.amount
  OR OLD.capital_in    IS DISTINCT FROM NEW.capital_in
  OR OLD.capital_out    IS DISTINCT FROM NEW.capital_out
  OR OLD.effective_date IS DISTINCT FROM NEW.effective_date
  OR OLD.card_id        IS DISTINCT FROM NEW.card_id
  OR OLD.user_id        IS DISTINCT FROM NEW.user_id
  OR OLD.source         IS DISTINCT FROM NEW.source THEN
    RAISE EXCEPTION 'balance_entries is append-only; create a superseding entry instead';
  END IF;
  IF OLD.superseded_at IS NOT NULL THEN
    IF OLD.superseded_by IS DISTINCT FROM OLD.id
       OR NEW.superseded_at IS DISTINCT FROM OLD.superseded_at
       OR NEW.superseded_by IS NULL
       OR NEW.superseded_by = OLD.id THEN
      RAISE EXCEPTION 'entry % is already superseded', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Если sendMessage не прошёл, last_sent_on можно вернуть и повторить в тот же день.
CREATE OR REPLACE FUNCTION ops_release_due_reminder(p_telegram_id text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $ops$
BEGIN
  UPDATE reminders r
  SET last_sent_on = NULL,
      updated_at = now()
  FROM users u
  WHERE u.id = r.user_id
    AND u.telegram_id::text = p_telegram_id;
END;
$ops$;

REVOKE ALL ON FUNCTION ops_release_due_reminder(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops_release_due_reminder(text) TO izicrm_app;

-- SECURITY DEFINER должен принадлежать суперпользователю миграций, иначе FORCE RLS
-- без app.current_user_id даёт нули (withOps не ставит пользовательский контекст).
ALTER FUNCTION ops_activity_snapshot(timestamptz, text) OWNER TO CURRENT_USER;
ALTER FUNCTION ops_claim_due_reminders(timestamptz) OWNER TO CURRENT_USER;
ALTER FUNCTION ops_release_due_reminder(text) OWNER TO CURRENT_USER;

-- Down Migration

REVOKE EXECUTE ON FUNCTION ops_release_due_reminder(text) FROM izicrm_app;
DROP FUNCTION IF EXISTS ops_release_due_reminder(text);

CREATE OR REPLACE FUNCTION be_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.amount        IS DISTINCT FROM NEW.amount
  OR OLD.capital_in    IS DISTINCT FROM NEW.capital_in
  OR OLD.capital_out    IS DISTINCT FROM NEW.capital_out
  OR OLD.effective_date IS DISTINCT FROM NEW.effective_date
  OR OLD.card_id        IS DISTINCT FROM NEW.card_id
  OR OLD.user_id        IS DISTINCT FROM NEW.user_id
  OR OLD.source         IS DISTINCT FROM NEW.source THEN
    RAISE EXCEPTION 'balance_entries is append-only; create a superseding entry instead';
  END IF;
  IF OLD.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'entry % is already superseded', OLD.id;
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE processed_updates DROP COLUMN IF EXISTS completed;

DELETE FROM processed_updates WHERE update_id !~ '^[1-9][0-9]*$';
ALTER TABLE processed_updates
  ALTER COLUMN update_id TYPE BIGINT USING update_id::bigint;
