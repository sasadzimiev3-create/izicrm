-- Up Migration

CREATE TYPE archive_reason AS ENUM ('WITHDRAWN', 'TRANSFERRED', 'LOST');
CREATE TYPE balance_entry_source AS ENUM (
  'CARD_CREATED',
  'DAILY_UPDATE',
  'TOP_UP',
  'SPEND',
  'CORRECTION',
  'ARCHIVE_TRANSFER_IN',
  'ARCHIVE_ZERO_OUT'
);
CREATE TYPE capital_flow_kind AS ENUM ('DEPOSIT', 'WITHDRAWAL');

-- Down Migration

DROP TYPE IF EXISTS capital_flow_kind;
DROP TYPE IF EXISTS balance_entry_source;
DROP TYPE IF EXISTS archive_reason;
