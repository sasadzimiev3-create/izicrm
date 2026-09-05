-- Up Migration

-- Дни до выката /admin в user_activity_days не писались. Восстанавливаем по фактам:
-- материал, запись баланса, аудит. Суммы в INSERT не входят. Повтор строк глотает PK.
INSERT INTO user_activity_days (user_id, activity_on)
SELECT user_id, created_on
FROM cards
UNION
SELECT user_id, (recorded_at AT TIME ZONE 'Europe/Moscow')::date
FROM balance_entries
UNION
SELECT user_id, (created_at AT TIME ZONE 'Europe/Moscow')::date
FROM audit_log
ON CONFLICT (user_id, activity_on) DO NOTHING;

-- Down Migration

-- Обратно отличить бэкафил от живых дней нельзя — строки не трогаем.
SELECT 1;
