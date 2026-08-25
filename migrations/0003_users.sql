-- Up Migration

CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id   BIGINT      NOT NULL UNIQUE,
  tz            TEXT        NOT NULL DEFAULT 'Europe/Moscow',
  language_code TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked_at    TIMESTAMPTZ
);

-- Down Migration

DROP TABLE IF EXISTS users;
