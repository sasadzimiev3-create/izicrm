-- Up Migration

CREATE OR REPLACE FUNCTION be_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.amount        IS DISTINCT FROM NEW.amount
  OR OLD.capital_in    IS DISTINCT FROM NEW.capital_in
  OR OLD.capital_out   IS DISTINCT FROM NEW.capital_out
  OR OLD.effective_date IS DISTINCT FROM NEW.effective_date
  OR OLD.card_id       IS DISTINCT FROM NEW.card_id
  OR OLD.user_id       IS DISTINCT FROM NEW.user_id
  OR OLD.source        IS DISTINCT FROM NEW.source THEN
    RAISE EXCEPTION 'balance_entries is append-only; create a superseding entry instead';
  END IF;
  IF OLD.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'entry % is already superseded', OLD.id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER be_immutable_trg BEFORE UPDATE ON balance_entries
  FOR EACH ROW EXECUTE FUNCTION be_immutable();

CREATE RULE be_no_delete AS ON DELETE TO balance_entries DO INSTEAD NOTHING;

-- Down Migration

DROP RULE IF EXISTS be_no_delete ON balance_entries;
DROP TRIGGER IF EXISTS be_immutable_trg ON balance_entries;
DROP FUNCTION IF EXISTS be_immutable();
