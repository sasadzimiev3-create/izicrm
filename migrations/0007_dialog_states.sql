-- Up Migration

CREATE TABLE dialog_states (
  user_id       BIGINT      PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  state         TEXT        NOT NULL,
  payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  business_date DATE,
  state_rev     INTEGER     NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX dialog_states_expiry_idx ON dialog_states (expires_at);

-- Down Migration

DROP TABLE IF EXISTS dialog_states;
