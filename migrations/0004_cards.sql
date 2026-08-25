-- Up Migration

CREATE TABLE cards (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        BIGINT      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  name           TEXT        NOT NULL,
  name_norm      TEXT        NOT NULL
                 GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) STORED,
  icon           TEXT,
  created_on     DATE        NOT NULL,
  frozen_on      DATE,
  frozen_at      TIMESTAMPTZ,
  archived_on    DATE,
  archive_reason archive_reason,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at    TIMESTAMPTZ,

  -- btrim(name) недостаточно: «\t» проходит, а name_norm становится пустым
  CONSTRAINT cards_name_not_blank    CHECK (name_norm <> ''),
  CONSTRAINT cards_name_len          CHECK (char_length(name) BETWEEN 1 AND 64),
  CONSTRAINT cards_icon_single_char  CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 8),
  CONSTRAINT cards_freeze_coherent CHECK (
    (frozen_on IS NULL AND frozen_at IS NULL) OR
    (frozen_on IS NOT NULL AND frozen_at IS NOT NULL)
  ),
  CONSTRAINT cards_freeze_not_archived CHECK (
    frozen_on IS NULL OR archived_on IS NULL
  ),
  CONSTRAINT cards_archive_coherent  CHECK (
    (archived_on IS NULL AND archived_at IS NULL AND archive_reason IS NULL) OR
    (archived_on IS NOT NULL AND archived_at IS NOT NULL AND archive_reason IS NOT NULL)
  ),
  CONSTRAINT cards_archive_after_create CHECK (archived_on IS NULL OR archived_on >= created_on),
  CONSTRAINT cards_user_id_unique UNIQUE (user_id, id)
);

CREATE UNIQUE INDEX cards_active_name_uniq
  ON cards (user_id, name_norm) WHERE archived_on IS NULL;

CREATE INDEX cards_user_active_idx ON cards (user_id) WHERE archived_on IS NULL;
CREATE INDEX cards_user_working_idx ON cards (user_id) WHERE archived_on IS NULL AND frozen_on IS NULL;
CREATE INDEX cards_user_scope_idx  ON cards (user_id, created_on, archived_on);

-- Down Migration

DROP TABLE IF EXISTS cards;
