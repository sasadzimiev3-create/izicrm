import type { ColumnType, Generated } from 'kysely';
import pg from 'pg';

export const PG_OID = {
  INT8: 20,
  DATE: 1082,
  NUMERIC: 1700,
} as const;

const identity = (value: string): string => value;

let configured = false;

/**
 * NUMERIC и BIGINT остаются строками; DATE — календарная дата `YYYY-MM-DD`, не `Date`.
 * Регистрировать parser в `number` запрещено (`docs/database.md` §7).
 */
export function configurePgTypes(): void {
  if (configured) {
    return;
  }
  pg.types.setTypeParser(PG_OID.NUMERIC, identity);
  pg.types.setTypeParser(PG_OID.INT8, identity);
  pg.types.setTypeParser(PG_OID.DATE, identity);
  configured = true;
}

/**
 * Assert на старте: parser NUMERIC — идентичность для строк.
 * Молчаливая регистрация parser в `number` ломает NFR-4.
 */
export function assertNumericParserIsIdentity(): void {
  const parser = pg.types.getTypeParser(PG_OID.NUMERIC);
  const sample = '1000000000000000.01';
  const parsed: unknown = parser(sample);
  if (typeof parsed !== 'string' || parsed !== sample) {
    throw new Error('pg NUMERIC parser must return the original decimal string');
  }
}

export type NumericString = string;
export type BigIntString = string;
export type IsoDate = string;

type Timestamptz = ColumnType<Date, Date | string, Date | string>;

export type ArchiveReason = 'WITHDRAWN' | 'TRANSFERRED' | 'LOST';

export type BalanceEntrySource =
  | 'CARD_CREATED'
  | 'DAILY_UPDATE'
  | 'TOP_UP'
  | 'SPEND'
  | 'CORRECTION'
  | 'ARCHIVE_TRANSFER_IN'
  | 'ARCHIVE_ZERO_OUT';

export type CapitalFlowKind = 'DEPOSIT' | 'WITHDRAWAL';

export type UsersTable = {
  id: Generated<BigIntString>;
  telegram_id: BigIntString;
  tz: string;
  language_code: string | null;
  created_at: Generated<Timestamptz>;
  blocked_at: Timestamptz | null;
};

export type CardsTable = {
  id: Generated<BigIntString>;
  user_id: BigIntString;
  name: string;
  name_norm: Generated<string>;
  icon: string | null;
  created_on: IsoDate;
  frozen_on: IsoDate | null;
  frozen_at: Timestamptz | null;
  archived_on: IsoDate | null;
  archive_reason: ArchiveReason | null;
  created_at: Generated<Timestamptz>;
  archived_at: Timestamptz | null;
};

export type BalanceEntriesTable = {
  id: Generated<BigIntString>;
  user_id: BigIntString;
  card_id: BigIntString;
  effective_date: IsoDate;
  amount: NumericString;
  capital_in: NumericString;
  capital_out: NumericString;
  source: BalanceEntrySource;
  recorded_at: Generated<Timestamptz>;
  superseded_at: Timestamptz | null;
  superseded_by: BigIntString | null;
};

export type DialogStatesTable = {
  user_id: BigIntString;
  state: string;
  payload: Record<string, unknown>;
  business_date: IsoDate | null;
  state_rev: Generated<number>;
  updated_at: Generated<Timestamptz>;
  expires_at: Timestamptz;
};

export type ProcessedUpdatesTable = {
  update_id: BigIntString;
  user_id: BigIntString | null;
  processed_at: Generated<Timestamptz>;
};

export type AuditLogTable = {
  id: Generated<BigIntString>;
  user_id: BigIntString;
  action: string;
  entity: string;
  entity_id: BigIntString | null;
  payload: Record<string, unknown>;
  created_at: Generated<Timestamptz>;
};

export type UserActivityDaysTable = {
  user_id: BigIntString;
  activity_on: IsoDate;
};

export type WebLoginsTable = {
  id: Generated<BigIntString>;
  user_id: BigIntString;
  logged_in_at: Generated<Timestamptz>;
};

export type CurrentBalanceEntriesView = {
  id: BigIntString;
  user_id: BigIntString;
  card_id: BigIntString;
  effective_date: IsoDate;
  amount: NumericString;
  capital_in: NumericString;
  capital_out: NumericString;
  source: BalanceEntrySource;
  recorded_at: Timestamptz;
};

export type CapitalFlowsView = {
  user_id: BigIntString;
  card_id: BigIntString;
  flow_date: IsoDate;
  kind: CapitalFlowKind;
  amount: NumericString;
};

export type Database = {
  users: UsersTable;
  cards: CardsTable;
  balance_entries: BalanceEntriesTable;
  dialog_states: DialogStatesTable;
  processed_updates: ProcessedUpdatesTable;
  audit_log: AuditLogTable;
  user_activity_days: UserActivityDaysTable;
  web_logins: WebLoginsTable;
  v_current_balance_entries: CurrentBalanceEntriesView;
  v_capital_flows: CapitalFlowsView;
};
