-- Up Migration

GRANT SELECT, DELETE ON processed_updates, dialog_states TO izicrm_maintenance;

-- DELETE-политики как в database.md §5.2. SELECT нужен отдельно: без него
-- обслуживание не видит просроченные строки и DELETE удаляет 0 (RLS скрывает их
-- до применения DELETE-политики). GRANT SELECT из ADR-011 иначе бесполезен.

CREATE POLICY processed_updates_gc ON processed_updates
  FOR DELETE TO izicrm_maintenance
  USING (processed_at < now() - interval '7 days');

CREATE POLICY processed_updates_gc_select ON processed_updates
  FOR SELECT TO izicrm_maintenance
  USING (processed_at < now() - interval '7 days');

CREATE POLICY dialog_states_gc ON dialog_states
  FOR DELETE TO izicrm_maintenance
  USING (expires_at < now());

CREATE POLICY dialog_states_gc_select ON dialog_states
  FOR SELECT TO izicrm_maintenance
  USING (expires_at < now());

-- Down Migration

DROP POLICY IF EXISTS dialog_states_gc_select ON dialog_states;
DROP POLICY IF EXISTS dialog_states_gc ON dialog_states;
DROP POLICY IF EXISTS processed_updates_gc_select ON processed_updates;
DROP POLICY IF EXISTS processed_updates_gc ON processed_updates;
REVOKE SELECT, DELETE ON processed_updates, dialog_states FROM izicrm_maintenance;
