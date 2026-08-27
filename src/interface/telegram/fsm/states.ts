import { z } from 'zod';

import { cardId, type CardId } from '../../../domain/cards/card.js';
import { parseBusinessDate, type BusinessDate } from '../../../domain/finance/period.js';

/**
 * Запись прохода обновления. Суммы — строки (ADR-005).
 */
export type UpdatedCard = {
  cardId: CardId;
  name: string;
  amount: string;
  previous: string;
  skipped: boolean;
};

/**
 * Размеченное объединение FSM. Деньги в payload — строки.
 *
 * @see docs/telegram-flows.md §2
 */
export type DialogState =
  | { t: 'Idle' }
  | { t: 'CardCreateName' }
  | { t: 'CardCreateBalance'; name: string }
  | { t: 'TopUpSelect' }
  | { t: 'TopUpAmount'; cardId: CardId; businessDate: BusinessDate }
  | { t: 'FreezeSelect' }
  | { t: 'SpendSelect' }
  | { t: 'UnfreezeSelect' }
  | { t: 'SpendAmount'; cardId: CardId; businessDate: BusinessDate }
  | { t: 'FrozenCardMenu'; cardId: CardId }
  | {
      t: 'BalanceUpdateAmount';
      queue: CardId[];
      index: number;
      businessDate: BusinessDate;
      done: UpdatedCard[];
    }
  | { t: 'ArchiveConfirm'; cardId: CardId }
  | { t: 'ArchiveDisposition'; cardId: CardId; lastBalance: string }
  | { t: 'ArchiveTarget'; cardId: CardId; amount: string }
  | { t: 'ReportBuilding' };

const cardIdSchema = z.number().int().positive();
const moneyStringSchema = z.string().min(1);
const nameSchema = z.string().min(1).max(64);
const businessDateSchema = z.string().transform((value) => parseBusinessDate(value));

const updatedCardSchema = z.object({
  cardId: cardIdSchema,
  name: z.string(),
  amount: moneyStringSchema,
  previous: moneyStringSchema.optional(),
  skipped: z.boolean(),
});

export const dialogStateSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('Idle') }),
  z.object({ t: z.literal('CardCreateName') }),
  z.object({ t: z.literal('CardCreateBalance'), name: nameSchema }),
  z.object({ t: z.literal('TopUpSelect') }),
  z.object({ t: z.literal('TopUpAmount'), cardId: cardIdSchema, businessDate: businessDateSchema }),
  z.object({ t: z.literal('FreezeSelect') }),
  z.object({ t: z.literal('SpendSelect') }),
  z.object({ t: z.literal('UnfreezeSelect') }),
  z.object({ t: z.literal('SpendAmount'), cardId: cardIdSchema, businessDate: businessDateSchema }),
  z.object({ t: z.literal('FrozenCardMenu'), cardId: cardIdSchema }),
  z.object({
    t: z.literal('BalanceUpdateAmount'),
    queue: z.array(cardIdSchema).min(1),
    index: z.number().int().nonnegative(),
    businessDate: businessDateSchema,
    done: z.array(updatedCardSchema),
  }),
  z.object({ t: z.literal('ArchiveConfirm'), cardId: cardIdSchema }),
  z.object({
    t: z.literal('ArchiveDisposition'),
    cardId: cardIdSchema,
    lastBalance: moneyStringSchema,
  }),
  z.object({ t: z.literal('ArchiveTarget'), cardId: cardIdSchema, amount: moneyStringSchema }),
  z.object({ t: z.literal('ReportBuilding') }),
]);

export const IDLE: DialogState = { t: 'Idle' };

function brandCardId(value: number): CardId {
  return cardId(value);
}

function brandUpdated(row: z.infer<typeof updatedCardSchema>): UpdatedCard {
  return {
    cardId: brandCardId(row.cardId),
    name: row.name,
    amount: row.amount,
    previous: row.previous ?? row.amount,
    skipped: row.skipped,
  };
}

/** Zod → брендированное состояние. Невалидный payload — Idle. */
export function parseDialogState(raw: unknown): DialogState {
  const parsed = dialogStateSchema.safeParse(raw);
  if (!parsed.success) {
    return IDLE;
  }
  const state = parsed.data;
  switch (state.t) {
    case 'Idle':
    case 'CardCreateName':
    case 'TopUpSelect':
    case 'FreezeSelect':
    case 'SpendSelect':
    case 'UnfreezeSelect':
    case 'ReportBuilding':
      return { t: state.t };
    case 'CardCreateBalance':
      return { t: 'CardCreateBalance', name: state.name };
    case 'TopUpAmount':
      return {
        t: 'TopUpAmount',
        cardId: brandCardId(state.cardId),
        businessDate: state.businessDate,
      };
    case 'SpendAmount':
      return {
        t: 'SpendAmount',
        cardId: brandCardId(state.cardId),
        businessDate: state.businessDate,
      };
    case 'FrozenCardMenu':
      return { t: 'FrozenCardMenu', cardId: brandCardId(state.cardId) };
    case 'BalanceUpdateAmount':
      return {
        t: 'BalanceUpdateAmount',
        queue: state.queue.map(brandCardId),
        index: state.index,
        businessDate: state.businessDate,
        done: state.done.map(brandUpdated),
      };
    case 'ArchiveConfirm':
      return { t: 'ArchiveConfirm', cardId: brandCardId(state.cardId) };
    case 'ArchiveDisposition':
      return {
        t: 'ArchiveDisposition',
        cardId: brandCardId(state.cardId),
        lastBalance: state.lastBalance,
      };
    case 'ArchiveTarget':
      return {
        t: 'ArchiveTarget',
        cardId: brandCardId(state.cardId),
        amount: state.amount,
      };
  }
}

export function serializeDialogState(state: DialogState): Record<string, unknown> {
  switch (state.t) {
    case 'Idle':
    case 'CardCreateName':
    case 'TopUpSelect':
    case 'FreezeSelect':
    case 'SpendSelect':
    case 'UnfreezeSelect':
    case 'ReportBuilding':
      return { t: state.t };
    case 'CardCreateBalance':
      return { t: state.t, name: state.name };
    case 'FrozenCardMenu':
    case 'ArchiveConfirm':
      return { t: state.t, cardId: state.cardId };
    case 'TopUpAmount':
    case 'SpendAmount':
      return { t: state.t, cardId: state.cardId, businessDate: state.businessDate };
    case 'BalanceUpdateAmount':
      return {
        t: state.t,
        queue: state.queue.map((id) => id as number),
        index: state.index,
        businessDate: state.businessDate,
        done: state.done.map((row) => ({
          cardId: row.cardId as number,
          name: row.name,
          amount: row.amount,
          previous: row.previous,
          skipped: row.skipped,
        })),
      };
    case 'ArchiveDisposition':
      return { t: state.t, cardId: state.cardId, lastBalance: state.lastBalance };
    case 'ArchiveTarget':
      return { t: state.t, cardId: state.cardId, amount: state.amount };
  }
}

export function businessDateOf(state: DialogState): BusinessDate | null {
  switch (state.t) {
    case 'TopUpAmount':
    case 'SpendAmount':
    case 'BalanceUpdateAmount':
      return state.businessDate;
    default:
      return null;
  }
}
