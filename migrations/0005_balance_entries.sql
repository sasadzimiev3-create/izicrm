-- Up Migration

CREATE TABLE balance_entries (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        BIGINT       NOT NULL,
  card_id        BIGINT       NOT NULL,
  effective_date DATE         NOT NULL,
  amount         NUMERIC(20,2) NOT NULL,
  capital_in     NUMERIC(20,2) NOT NULL DEFAULT 0,
  capital_out    NUMERIC(20,2) NOT NULL DEFAULT 0,
  source         balance_entry_source NOT NULL,
  recorded_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  superseded_at  TIMESTAMPTZ,
  superseded_by  BIGINT       REFERENCES balance_entries (id) ON DELETE RESTRICT,

  CONSTRAINT be_card_fk FOREIGN KEY (user_id, card_id)
    REFERENCES cards (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT be_supersede_coherent CHECK ((superseded_at IS NULL) = (superseded_by IS NULL)),
  CONSTRAINT be_amount_bounded CHECK (amount BETWEEN -1000000000000000.00 AND 1000000000000000.00),
  CONSTRAINT be_capital_in_bounded CHECK (capital_in BETWEEN 0 AND 1000000000000000.00),
  CONSTRAINT be_capital_out_bounded CHECK (capital_out BETWEEN 0 AND 1000000000000000.00)
);

CREATE UNIQUE INDEX be_current_per_card_day_uniq
  ON balance_entries (card_id, effective_date) WHERE superseded_at IS NULL;

CREATE INDEX be_locf_idx
  ON balance_entries (user_id, card_id, effective_date DESC) WHERE superseded_at IS NULL;

CREATE INDEX be_user_date_idx
  ON balance_entries (user_id, effective_date DESC) WHERE superseded_at IS NULL;

-- Down Migration

DROP TABLE IF EXISTS balance_entries;
