-- Up Migration

-- Дни: бит 0 = понедельник … бит 6 = воскресенье. Время одно на всю неделю (минуты от 00:00).
CREATE TABLE reminders (
  user_id        BIGINT  PRIMARY KEY REFERENCES users (id) ON DELETE RESTRICT,
  enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  notify_minute  SMALLINT NOT NULL DEFAULT 1260
                 CHECK (notify_minute BETWEEN 0 AND 1439),
  days           SMALLINT NOT NULL DEFAULT 0
                 CHECK (days BETWEEN 0 AND 127),
  last_sent_on   DATE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders FORCE ROW LEVEL SECURITY;

CREATE POLICY reminders_isolation ON reminders
  USING      (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

GRANT SELECT, INSERT, UPDATE ON reminders TO izicrm_app;

CREATE TABLE user_feedback (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  message    TEXT   NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_feedback_message_len CHECK (char_length(message) BETWEEN 1 AND 2000)
);

CREATE INDEX user_feedback_user_idx ON user_feedback (user_id, created_at DESC);

ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_feedback FORCE ROW LEVEL SECURITY;

CREATE POLICY user_feedback_isolation ON user_feedback
  USING      (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

GRANT SELECT, INSERT ON user_feedback TO izicrm_app;
GRANT USAGE, SELECT ON SEQUENCE user_feedback_id_seq TO izicrm_app;

CREATE OR REPLACE FUNCTION ops_claim_due_reminders(p_now timestamptz)
RETURNS TABLE(telegram_id text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $ops$
BEGIN
  RETURN QUERY
  UPDATE reminders r
  SET last_sent_on = (p_now AT TIME ZONE u.tz)::date,
      updated_at = p_now
  FROM users u
  WHERE u.id = r.user_id
    AND r.enabled
    AND u.blocked_at IS NULL
    AND r.days <> 0
    AND ((r.days >> ((EXTRACT(ISODOW FROM (p_now AT TIME ZONE u.tz))::int) - 1)) & 1) = 1
    AND (p_now AT TIME ZONE u.tz) >= ((p_now AT TIME ZONE u.tz)::date
          + make_interval(mins => r.notify_minute))
    AND (p_now AT TIME ZONE u.tz) < ((p_now AT TIME ZONE u.tz)::date
          + make_interval(mins => r.notify_minute)
          + interval '10 minutes')
    AND r.last_sent_on IS DISTINCT FROM (p_now AT TIME ZONE u.tz)::date
  RETURNING u.telegram_id::text;
END;
$ops$;

REVOKE ALL ON FUNCTION ops_claim_due_reminders(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops_claim_due_reminders(timestamptz) TO izicrm_app;

-- Down Migration

REVOKE EXECUTE ON FUNCTION ops_claim_due_reminders(timestamptz) FROM izicrm_app;
DROP FUNCTION IF EXISTS ops_claim_due_reminders(timestamptz);

DROP POLICY IF EXISTS user_feedback_isolation ON user_feedback;
REVOKE USAGE, SELECT ON SEQUENCE user_feedback_id_seq FROM izicrm_app;
REVOKE SELECT, INSERT ON user_feedback FROM izicrm_app;
DROP TABLE IF EXISTS user_feedback;

DROP POLICY IF EXISTS reminders_isolation ON reminders;
REVOKE SELECT, INSERT, UPDATE ON reminders FROM izicrm_app;
DROP TABLE IF EXISTS reminders;
