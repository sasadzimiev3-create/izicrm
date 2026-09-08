-- Up Migration

-- Сколько уникальных людей сегодня/за неделю что-то сделали: любой апдейт бота,
-- любое действие в кабинете или первое /start. Сумм нет.
CREATE OR REPLACE FUNCTION ops_activity_snapshot(p_now timestamptz, p_tz text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $ops$
DECLARE
  today_start timestamptz;
  today_end timestamptz;
  week_start timestamptz;
  today_date date;
  week_from date;
  yesterday date;
BEGIN
  today_start := date_trunc('day', p_now AT TIME ZONE p_tz) AT TIME ZONE p_tz;
  today_end := today_start + interval '1 day';
  week_start := today_start - interval '6 days';
  today_date := (p_now AT TIME ZONE p_tz)::date;
  week_from := today_date - 6;
  yesterday := today_date - 1;

  RETURN jsonb_build_object(
    'usedToday', (
      SELECT COUNT(*)::text FROM (
        SELECT d.user_id FROM user_activity_days d WHERE d.activity_on = today_date
        UNION
        SELECT u.id FROM users u
        WHERE u.created_at >= today_start AND u.created_at < today_end
      ) t
    ),
    'usedWeek', (
      SELECT COUNT(*)::text FROM (
        SELECT d.user_id FROM user_activity_days d
        WHERE d.activity_on BETWEEN week_from AND today_date
        UNION
        SELECT u.id FROM users u
        WHERE u.created_at >= week_start AND u.created_at < today_end
      ) t
    ),
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
ALTER FUNCTION ops_activity_snapshot(timestamptz, text) OWNER TO CURRENT_USER;

-- Down Migration

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
ALTER FUNCTION ops_activity_snapshot(timestamptz, text) OWNER TO CURRENT_USER;
