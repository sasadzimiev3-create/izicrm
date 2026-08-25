-- Up Migration

CREATE TABLE audit_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  action     TEXT        NOT NULL,
  entity     TEXT        NOT NULL,
  entity_id  BIGINT,
  payload    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_user_idx ON audit_log (user_id, created_at DESC);

-- Down Migration

DROP TABLE IF EXISTS audit_log;
