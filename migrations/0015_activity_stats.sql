-- Up Migration

-- Календарные дни, когда пользователь что-то сделал после первого /start.
-- Сумм нет. Одна строка на человека в день.
CREATE TABLE user_activity_days (
  user_id      BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  activity_on  DATE   NOT NULL,
  PRIMARY KEY (user_id, activity_on)
);

CREATE INDEX user_activity_days_on_idx ON user_activity_days (activity_on);

ALTER TABLE user_activity_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_days FORCE ROW LEVEL SECURITY;

CREATE POLICY user_activity_days_isolation ON user_activity_days
  USING      (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

GRANT SELECT, INSERT ON user_activity_days TO izicrm_app;

-- Успешный вход в кабинет по ссылке из бота.
CREATE TABLE web_logins (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  logged_in_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX web_logins_at_idx ON web_logins (logged_in_at DESC);
CREATE INDEX web_logins_user_idx ON web_logins (user_id, logged_in_at DESC);

ALTER TABLE web_logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_logins FORCE ROW LEVEL SECURITY;

CREATE POLICY web_logins_isolation ON web_logins
  USING      (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

GRANT SELECT, INSERT ON web_logins TO izicrm_app;
GRANT USAGE, SELECT ON SEQUENCE web_logins_id_seq TO izicrm_app;

CREATE OR REPLACE FUNCTION ops_activity_snapshot(p_now timestamptz, p_tz text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $ops$
DECLARE
  today_start timestamptz;
  week_start timestamptz;
  today_date date;
  week_from date;
  yesterday date;
BEGIN
  today_start := date_trunc('day', p_now AT TIME ZONE p_tz) AT TIME ZONE p_tz;
  week_start := today_start - interval '6 days';
  today_date := (p_now AT TIME ZONE p_tz)::date;
  week_from := today_date - 6;
  yesterday := today_date - 1;

  RETURN jsonb_build_object(
    'newStartToday', (
      SELECT COUNT(*)::text FROM users u WHERE u.created_at >= today_start
    ),
    'newStartWeek', (
      SELECT COUNT(*)::text FROM users u WHERE u.created_at >= week_start
    ),
    'usedAfterStartToday', (
      SELECT COUNT(*)::text FROM user_activity_days d WHERE d.activity_on = today_date
    ),
    'usedAfterStartWeek', (
      SELECT COUNT(DISTINCT d.user_id)::text
      FROM user_activity_days d
      WHERE d.activity_on BETWEEN week_from AND today_date
    ),
    'streakToday', (
      SELECT COUNT(*)::text
      FROM user_activity_days today
      JOIN user_activity_days prior
        ON prior.user_id = today.user_id
       AND prior.activity_on = yesterday
      WHERE today.activity_on = today_date
    ),
    'streakWeek', (
      SELECT COUNT(DISTINCT a.user_id)::text
      FROM user_activity_days a
      JOIN user_activity_days b
        ON b.user_id = a.user_id
       AND b.activity_on = a.activity_on + 1
      WHERE a.activity_on >= week_from
        AND b.activity_on <= today_date
    ),
    'webToday', (
      SELECT COUNT(DISTINCT w.user_id)::text
      FROM web_logins w
      WHERE w.logged_in_at >= today_start
    ),
    'webWeek', (
      SELECT COUNT(DISTINCT w.user_id)::text
      FROM web_logins w
      WHERE w.logged_in_at >= week_start
    ),
    'registeredAll', (SELECT COUNT(*)::text FROM users),
    'blockedAll', (
      SELECT COUNT(*)::text FROM users u WHERE u.blocked_at IS NOT NULL
    ),
    'withMaterialAll', (
      SELECT COUNT(DISTINCT c.user_id)::text FROM cards c
    )
  );
END;
$ops$;

REVOKE ALL ON FUNCTION ops_activity_snapshot(timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops_activity_snapshot(timestamptz, text) TO izicrm_app;

-- Down Migration

REVOKE EXECUTE ON FUNCTION ops_activity_snapshot(timestamptz, text) FROM izicrm_app;
DROP FUNCTION IF EXISTS ops_activity_snapshot(timestamptz, text);

DROP POLICY IF EXISTS web_logins_isolation ON web_logins;
REVOKE USAGE, SELECT ON SEQUENCE web_logins_id_seq FROM izicrm_app;
REVOKE SELECT, INSERT ON web_logins FROM izicrm_app;
DROP TABLE IF EXISTS web_logins;

DROP POLICY IF EXISTS user_activity_days_isolation ON user_activity_days;
REVOKE SELECT, INSERT ON user_activity_days FROM izicrm_app;
DROP TABLE IF EXISTS user_activity_days;
