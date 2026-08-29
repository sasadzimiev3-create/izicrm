import type { CardId } from '../../../domain/cards/card.js';

import type { DialogEvent } from './events.js';
import type { Effect, ReduceResult } from './effects.js';
import { IDLE, type DialogState, type UpdatedCard } from './states.js';

function result(next: DialogState, ...effects: Effect[]): ReduceResult {
  return { next, effects };
}

function stay(state: DialogState, ...effects: Effect[]): ReduceResult {
  return { next: state, effects };
}

function home(): ReduceResult {
  return result(IDLE, { t: 'ShowHome' });
}

function nextUpdate(
  state: Extract<DialogState, { t: 'BalanceUpdateAmount' }>,
  done: UpdatedCard[],
  apply: Effect | null,
): ReduceResult {
  const index = state.index + 1;
  if (index >= state.queue.length) {
    return result(IDLE, ...(apply === null ? [] : [apply]), { t: 'ShowHome' });
  }
  return result(
    { ...state, index, done },
    ...(apply === null ? [] : [apply]),
    { t: 'PromptUpdate' },
  );
}

function currentQueueId(state: Extract<DialogState, { t: 'BalanceUpdateAmount' }>): CardId {
  const id = state.queue[state.index];
  if (id === undefined) {
    throw new Error('balance update queue index is out of range');
  }
  return id;
}

/**
 * Чистая функция перехода. Без I/O, без Telegram, без Date.now().
 *
 * @see docs/telegram-flows.md §3
 */
export function reduce(state: DialogState, event: DialogEvent): ReduceResult {
  if (event.t === 'Cancel') {
    return home();
  }
  if (event.t === 'Expired') {
    return result(IDLE, { t: 'Expired' });
  }
  if (event.t === 'Stale') {
    return result(IDLE, { t: 'Stale' });
  }
  if (event.t === 'NotFound') {
    return stay(state, { t: 'NotFound' });
  }
  if (event.t === 'Start' || event.t === 'Home') {
    return home();
  }

  switch (state.t) {
    case 'Idle':
      return reduceIdle(event);
    case 'CardCreateName':
      return reduceCreateName(state, event);
    case 'CardCreateBalance':
      return reduceCreateBalance(state, event);
    case 'TopUpSelect':
      return reduceTopUpSelect(state, event);
    case 'TopUpAmount':
      return reduceTopUpAmount(state, event);
    case 'FreezeSelect':
      return reduceFreezeSelect(state, event);
    case 'SpendSelect':
      return reduceSpendSelect(state, event);
    case 'UnfreezeSelect':
      return reduceUnfreezeSelect(state, event);
    case 'SpendAmount':
      return reduceSpendAmount(state, event);
    case 'FrozenCardMenu':
      return reduceFrozenMenu(state, event);
    case 'BalanceUpdateAmount':
      return reduceBalanceUpdate(state, event);
    case 'ArchiveConfirm':
      return reduceArchiveConfirm(state, event);
    case 'ArchiveDisposition':
      return reduceDisposition(state, event);
    case 'ArchiveTarget':
      return reduceArchiveTarget(state, event);
    case 'ReportBuilding':
      return reduceReport(state, event);
  }
}

function reduceIdle(event: DialogEvent): ReduceResult {
  switch (event.t) {
    case 'Settings':
      return result(IDLE, { t: 'ShowSettings' });
    case 'Report':
      return result({ t: 'ReportBuilding' }, { t: 'BuildReport' });
    case 'TopUpMenu':
      return result(IDLE, { t: 'ShowTopUpMenu' });
    case 'CardAdd':
      return result({ t: 'CardCreateName' }, { t: 'PromptName' });
    case 'TopUpPick':
      return result({ t: 'TopUpSelect' }, { t: 'ShowTopUpList' });
    case 'TopUpCard':
      return result(
        { t: 'TopUpAmount', cardId: event.cardId, businessDate: event.businessDate },
        { t: 'PromptTopUp' },
      );
    case 'ExpenseMenu':
      return result(IDLE, { t: 'ShowExpenseMenu' });
    case 'FreezePick':
      return result({ t: 'FreezeSelect' }, { t: 'ShowFreezeList' });
    case 'FreezeCard':
      return result(IDLE, { t: 'ApplyFreeze', cardId: event.cardId });
    case 'SpendPick':
      return result({ t: 'SpendSelect' }, { t: 'ShowSpendList' });
    case 'UnfreezePick':
      return result({ t: 'UnfreezeSelect' }, { t: 'ShowUnfreezeList' });
    case 'SpendCard':
      return result(
        { t: 'SpendAmount', cardId: event.cardId, businessDate: event.businessDate },
        { t: 'PromptSpend' },
      );
    case 'FrozenMenu':
      return result({ t: 'FrozenCardMenu', cardId: event.cardId }, { t: 'ShowFrozenMenu', cardId: event.cardId });
    case 'Unfreeze':
      return result(IDLE, { t: 'ApplyUnfreeze', cardId: event.cardId });
    case 'UpdateAll':
      if (event.queue.length === 0) {
        return result(IDLE, { t: 'NoWorkingCards' });
      }
      return result(
        {
          t: 'BalanceUpdateAmount',
          queue: event.queue,
          index: 0,
          businessDate: event.businessDate,
          done: [],
        },
        { t: 'PromptUpdate' },
      );
    case 'UpdateOne':
      return result(
        {
          t: 'BalanceUpdateAmount',
          queue: [event.cardId],
          index: 0,
          businessDate: event.businessDate,
          done: [],
        },
        { t: 'PromptUpdate' },
      );
    case 'NoWorkingCards':
      return result(IDLE, { t: 'NoWorkingCards' });
    case 'ArchivePick':
      return result(IDLE, { t: 'ShowArchiveList' });
    case 'ArchiveList':
      return result(IDLE, { t: 'ShowArchived' });
    case 'Archive':
      return result({ t: 'ArchiveConfirm', cardId: event.cardId }, { t: 'PromptArchiveConfirm', cardId: event.cardId });
    default:
      return result(IDLE, { t: 'ShowHome' });
  }
}

function reduceCreateName(state: DialogState, event: DialogEvent): ReduceResult {
  switch (event.t) {
    case 'NameEntered':
      return result({ t: 'CardCreateBalance', name: event.name }, { t: 'PromptBalance', name: event.name });
    case 'NameDuplicate':
      return stay(state, { t: 'NameTaken' });
    case 'NameInvalid':
      return stay(state, { t: 'InvalidInput', message: event.message });
    default:
      return stay(state, { t: 'Ignore' });
  }
}

function reduceCreateBalance(state: Extract<DialogState, { t: 'CardCreateBalance' }>, event: DialogEvent): ReduceResult {
  switch (event.t) {
    case 'AmountEntered':
      return result(IDLE, {
        t: 'CreateCard',
        name: state.name,
        amount: event.amount,
      });
    case 'AmountInvalid':
      return stay(state, { t: 'InvalidInput', message: event.message });
    default:
      return stay(state, { t: 'Ignore' });
  }
}

function reduceTopUpSelect(state: DialogState, event: DialogEvent): ReduceResult {
  if (event.t === 'TopUpCard') {
    return result(
      { t: 'TopUpAmount', cardId: event.cardId, businessDate: event.businessDate },
      { t: 'PromptTopUp' },
    );
  }
  if (event.t === 'TopUpMenu') {
    return result(IDLE, { t: 'ShowTopUpMenu' });
  }
  if (event.t === 'Home') {
    return home();
  }
  return stay(state, { t: 'Ignore' });
}

function reduceTopUpAmount(state: Extract<DialogState, { t: 'TopUpAmount' }>, event: DialogEvent): ReduceResult {
  switch (event.t) {
    case 'AmountEntered':
      return result(IDLE, {
        t: 'ApplyTopUp',
        cardId: state.cardId,
        amount: event.amount,
        businessDate: state.businessDate,
      });
    case 'AmountInvalid':
      return stay(state, { t: 'InvalidInput', message: event.message });
    default:
      return stay(state, { t: 'Ignore' });
  }
}

function reduceFreezeSelect(state: DialogState, event: DialogEvent): ReduceResult {
  if (event.t === 'FreezeCard') {
    return result(IDLE, { t: 'ApplyFreeze', cardId: event.cardId });
  }
  if (event.t === 'ExpenseMenu') {
    return result(IDLE, { t: 'ShowExpenseMenu' });
  }
  return stay(state, { t: 'Ignore' });
}

function reduceSpendSelect(state: DialogState, event: DialogEvent): ReduceResult {
  if (event.t === 'SpendCard') {
    return result(
      { t: 'SpendAmount', cardId: event.cardId, businessDate: event.businessDate },
      { t: 'PromptSpend' },
    );
  }
  if (event.t === 'ExpenseMenu') {
    return result(IDLE, { t: 'ShowExpenseMenu' });
  }
  return stay(state, { t: 'Ignore' });
}

function reduceUnfreezeSelect(state: DialogState, event: DialogEvent): ReduceResult {
  if (event.t === 'FrozenMenu') {
    return result({ t: 'FrozenCardMenu', cardId: event.cardId }, { t: 'ShowFrozenMenu', cardId: event.cardId });
  }
  if (event.t === 'ExpenseMenu') {
    return result(IDLE, { t: 'ShowExpenseMenu' });
  }
  return stay(state, { t: 'Ignore' });
}

function reduceSpendAmount(state: Extract<DialogState, { t: 'SpendAmount' }>, event: DialogEvent): ReduceResult {
  switch (event.t) {
    case 'AmountEntered':
      return result(IDLE, {
        t: 'ApplySpend',
        cardId: state.cardId,
        amount: event.amount,
        businessDate: state.businessDate,
      });
    case 'AmountInvalid':
      return stay(state, { t: 'InvalidInput', message: event.message });
    default:
      return stay(state, { t: 'Ignore' });
  }
}

function reduceFrozenMenu(state: Extract<DialogState, { t: 'FrozenCardMenu' }>, event: DialogEvent): ReduceResult {
  switch (event.t) {
    case 'Unfreeze':
      return result(IDLE, { t: 'ApplyUnfreeze', cardId: state.cardId });
    case 'UpdateOne':
      return result(
        {
          t: 'BalanceUpdateAmount',
          queue: [state.cardId],
          index: 0,
          businessDate: event.businessDate,
          done: [],
        },
        { t: 'PromptUpdate' },
      );
    default:
      return stay(state, { t: 'Ignore' });
  }
}

function reduceBalanceUpdate(
  state: Extract<DialogState, { t: 'BalanceUpdateAmount' }>,
  event: DialogEvent,
): ReduceResult {
  const cardId = currentQueueId(state);
  switch (event.t) {
    case 'AmountEntered': {
      const done: UpdatedCard[] = [
        ...state.done,
        {
          cardId,
          name: event.name,
          amount: event.amount,
          previous: event.previous ?? event.amount,
          skipped: false,
        },
      ];
      return nextUpdate(state, done, {
        t: 'ApplyUpdate',
        cardId,
        amount: event.amount,
        businessDate: state.businessDate,
      });
    }
    case 'Skip': {
      const done: UpdatedCard[] = [
        ...state.done,
        { cardId, name: event.name, amount: '0.00', previous: event.previous, skipped: true },
      ];
      return nextUpdate(state, done, null);
    }
    case 'AmountInvalid':
      return stay(state, { t: 'InvalidInput', message: event.message });
    default:
      return stay(state, { t: 'Ignore' });
  }
}

function reduceArchiveConfirm(
  state: Extract<DialogState, { t: 'ArchiveConfirm' }>,
  event: DialogEvent,
): ReduceResult {
  if (event.t !== 'ArchiveYes') {
    return stay(state, { t: 'Ignore' });
  }
  if (!event.needsDisposition) {
    return result(IDLE, {
      t: 'ApplyArchive',
      cardId: state.cardId,
      reason: 'WITHDRAWN',
    });
  }
  return result(
    { t: 'ArchiveDisposition', cardId: state.cardId, lastBalance: event.remainder },
    { t: 'PromptDisposition', name: event.name, remainder: event.remainder },
  );
}

function reduceDisposition(
  state: Extract<DialogState, { t: 'ArchiveDisposition' }>,
  event: DialogEvent,
): ReduceResult {
  switch (event.t) {
    case 'Withdrawn':
      return result(IDLE, { t: 'ApplyArchive', cardId: state.cardId, reason: 'WITHDRAWN' });
    case 'Lost':
      return result(IDLE, { t: 'ApplyArchive', cardId: state.cardId, reason: 'LOST' });
    case 'Transferred':
      return result(
        { t: 'ArchiveTarget', cardId: state.cardId, amount: state.lastBalance },
        { t: 'ShowArchiveTargets' },
      );
    default:
      return stay(state, { t: 'Ignore' });
  }
}

function reduceArchiveTarget(
  state: Extract<DialogState, { t: 'ArchiveTarget' }>,
  event: DialogEvent,
): ReduceResult {
  if (event.t === 'ArchiveTarget') {
    return result(IDLE, {
      t: 'ApplyArchive',
      cardId: state.cardId,
      reason: 'TRANSFERRED',
      targetCardId: event.cardId,
    });
  }
  return stay(state, { t: 'Ignore' });
}

function reduceReport(state: DialogState, event: DialogEvent): ReduceResult {
  switch (event.t) {
    case 'ReportDone':
      return home();
    case 'ReportFailed':
      return result(IDLE, { t: 'ReportUnavailable', message: event.message });
    default:
      return stay(state, { t: 'Ignore' });
  }
}
