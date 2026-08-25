-- Сборка мусора служебных таблиц. Выполняется ролью izicrm_maintenance (ADR-011, C-23).
-- Политики RLS оставляют только просроченные строки: живой диалог этим DELETE не снять.

DELETE FROM processed_updates
 WHERE processed_at < now() - interval '7 days';

DELETE FROM dialog_states
 WHERE expires_at < now();
