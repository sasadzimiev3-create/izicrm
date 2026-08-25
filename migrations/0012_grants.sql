-- Up Migration

GRANT USAGE ON TYPE archive_reason TO izicrm_app;
GRANT USAGE ON TYPE balance_entry_source TO izicrm_app;
GRANT USAGE ON TYPE capital_flow_kind TO izicrm_app;

GRANT SELECT, INSERT, UPDATE ON cards, balance_entries, dialog_states,
                                processed_updates, users TO izicrm_app;
GRANT SELECT, INSERT ON audit_log TO izicrm_app;
GRANT SELECT ON v_current_balance_entries, v_capital_flows TO izicrm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO izicrm_app;

-- Down Migration

REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM izicrm_app;
REVOKE SELECT ON v_current_balance_entries, v_capital_flows FROM izicrm_app;
REVOKE SELECT, INSERT ON audit_log FROM izicrm_app;
REVOKE SELECT, INSERT, UPDATE ON cards, balance_entries, dialog_states,
                                 processed_updates, users FROM izicrm_app;
REVOKE USAGE ON TYPE archive_reason FROM izicrm_app;
REVOKE USAGE ON TYPE balance_entry_source FROM izicrm_app;
REVOKE USAGE ON TYPE capital_flow_kind FROM izicrm_app;
