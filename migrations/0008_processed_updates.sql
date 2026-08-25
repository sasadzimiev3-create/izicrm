-- Up Migration

CREATE TABLE processed_updates (
  update_id    BIGINT      PRIMARY KEY,
  user_id      BIGINT      REFERENCES users (id) ON DELETE CASCADE,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX processed_updates_gc_idx ON processed_updates (processed_at);

-- Down Migration

DROP TABLE IF EXISTS processed_updates;
