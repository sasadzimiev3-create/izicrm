import type { CardRow, CapitalFlowRow } from '../../application/ports/card-repository.js';
import type { LocfBalance } from '../../application/ports/balance-repository.js';
import type { JournalEntry } from '../../application/ports/report-query-repository.js';
import type { DialogStateRecord } from '../../application/ports/dialog-state-repository.js';
import type { UserRecord } from '../../application/ports/user-repository.js';
import type { ArchiveReason } from '../../domain/cards/card.js';
import type { BalanceEntry } from '../../domain/finance/balance.js';
import { parseBusinessDate } from '../../domain/finance/period.js';
import { Money } from '../../domain/money/money.js';

import { parseCardId, parseUserId } from '../db/ids.js';

export type CardTableRow = {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  created_on: string;
  frozen_on: string | null;
  archived_on: string | null;
  archive_reason: ArchiveReason | null;
};

export function toCardRow(row: CardTableRow): CardRow {
  const shared = {
    id: parseCardId(row.id),
    userId: parseUserId(row.user_id),
    name: row.name,
    icon: row.icon,
    createdOn: parseBusinessDate(row.created_on),
    frozenOn: row.frozen_on === null ? null : parseBusinessDate(row.frozen_on),
  };
  if (row.archived_on === null) {
    return { ...shared, archivedOn: null, archiveReason: null };
  }
  if (row.archive_reason === null) {
    throw new Error('archived card is missing archive_reason');
  }
  return {
    ...shared,
    archivedOn: parseBusinessDate(row.archived_on),
    archiveReason: row.archive_reason,
  };
}

export function toMoney(amount: string): Money {
  return Money.from(amount);
}

export function toLocfBalance(row: {
  card_id: string;
  amount: string;
  capital_in: string;
  capital_out: string;
  effective_date: string;
}): LocfBalance {
  return {
    cardId: parseCardId(row.card_id),
    amount: toMoney(row.amount),
    capitalIn: toMoney(row.capital_in),
    capitalOut: toMoney(row.capital_out),
    effectiveDate: parseBusinessDate(row.effective_date),
  };
}

export function toBalanceEntry(row: {
  card_id: string;
  amount: string;
  capital_in: string;
  capital_out: string;
  effective_date: string;
}): BalanceEntry {
  return {
    cardId: parseCardId(row.card_id),
    amount: toMoney(row.amount),
    capitalIn: toMoney(row.capital_in),
    capitalOut: toMoney(row.capital_out),
    effectiveDate: parseBusinessDate(row.effective_date),
  };
}

export function toJournalEntry(row: {
  card_id: string;
  name: string;
  effective_date: string;
  amount: string;
  capital_in: string;
  capital_out: string;
  source: JournalEntry['source'];
}): JournalEntry {
  return {
    cardId: parseCardId(row.card_id),
    cardName: row.name,
    effectiveDate: parseBusinessDate(row.effective_date),
    amount: toMoney(row.amount),
    capitalIn: toMoney(row.capital_in),
    capitalOut: toMoney(row.capital_out),
    source: row.source,
  };
}

export function toCapitalFlowRow(row: {
  card_id: string;
  flow_date: string;
  kind: 'DEPOSIT' | 'WITHDRAWAL';
  amount: string;
}): CapitalFlowRow {
  return {
    cardId: parseCardId(row.card_id),
    flowDate: parseBusinessDate(row.flow_date),
    kind: row.kind,
    amount: toMoney(row.amount),
  };
}

export function toUserRecord(row: {
  id: string;
  telegram_id: string;
  tz: string;
  language_code: string | null;
}): UserRecord {
  return {
    id: parseUserId(row.id),
    telegramId: row.telegram_id,
    tz: row.tz,
    languageCode: row.language_code,
  };
}

export function toDialogStateRecord(row: {
  user_id: string;
  state: string;
  payload: unknown;
  business_date: string | null;
  state_rev: number;
  expires_at: Date;
}): DialogStateRecord {
  return {
    userId: parseUserId(row.user_id),
    state: row.state,
    payload: asJsonObject(row.payload),
    businessDate: row.business_date === null ? null : parseBusinessDate(row.business_date),
    stateRev: row.state_rev,
    expiresAt: row.expires_at,
  };
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
