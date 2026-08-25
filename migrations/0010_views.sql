-- Up Migration

CREATE VIEW v_current_balance_entries WITH (security_invoker = true) AS
SELECT id, user_id, card_id, effective_date, amount, capital_in, capital_out, source, recorded_at
FROM balance_entries
WHERE superseded_at IS NULL;

CREATE VIEW v_capital_flows WITH (security_invoker = true) AS
SELECT e.user_id,
       e.card_id,
       e.effective_date           AS flow_date,
       'DEPOSIT'::capital_flow_kind AS kind,
       e.capital_in               AS amount
FROM v_current_balance_entries e
WHERE e.capital_in <> 0

UNION ALL

SELECT e.user_id,
       e.card_id,
       e.effective_date,
       'WITHDRAWAL'::capital_flow_kind,
       e.capital_out
FROM v_current_balance_entries e
WHERE e.capital_out <> 0

UNION ALL

SELECT c.user_id,
       c.id,
       c.archived_on,
       'WITHDRAWAL'::capital_flow_kind,
       last_entry.amount
FROM cards c
CROSS JOIN LATERAL (
  SELECT e.amount
  FROM v_current_balance_entries e
  WHERE e.card_id = c.id AND e.effective_date <= c.archived_on
  ORDER BY e.effective_date DESC
  LIMIT 1
) AS last_entry
WHERE c.archived_on IS NOT NULL
  AND c.archive_reason = 'WITHDRAWN'
  AND last_entry.amount <> 0;

-- Down Migration

DROP VIEW IF EXISTS v_capital_flows;
DROP VIEW IF EXISTS v_current_balance_entries;
