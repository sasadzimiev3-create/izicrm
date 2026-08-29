import { assertCardName } from '../../application/services/card.service.js';
import { normalizeCardName } from '../../domain/cards/card-name.js';
import { cardId, type CardId, type UserId } from '../../domain/cards/card.js';
import {
  ConflictError,
  NotFoundError,
  StaleCallbackError,
  ValidationError,
} from '../../domain/errors.js';
import { isFrozen, isInScope, isWorking } from '../../domain/finance/card-scope.js';
import type { BusinessDate } from '../../domain/finance/period.js';
import { parseAmount } from '../../domain/money/parse.js';
import { Money } from '../../domain/money/money.js';
import { formatMoney } from '../../domain/money/format.js';
import type { UserRecord } from '../../application/ports/user-repository.js';
import type { Dashboard } from '../../application/dto/dashboard.js';
import type { DbTx } from '../../application/ports/unit-of-work.js';

import type { TelegramDeps } from './deps.js';
import type { DialogEvent } from './fsm/events.js';
import type { Effect } from './fsm/effects.js';
import { dialogExpiresAt, assertFreshRev } from './fsm/guards.js';
import { loadDialog, toUpsert } from './fsm/machine.js';
import { IDLE, serializeDialogState, type DialogState } from './fsm/states.js';
import { reduce } from './fsm/transitions.js';
import { parseCallbackData, type CallbackAction } from './keyboards/callback-data.js';
import {
  archiveConfirmKeyboard,
  cancelKeyboard,
  cardPickerKeyboard,
  dashboardKeyboard,
  dispositionKeyboard,
  expenseMenuKeyboard,
  frozenCardKeyboard,
  noWorkingKeyboard,
  settingsKeyboard,
  topUpMenuKeyboard,
  updatePromptKeyboard,
  type Keyboard,
  type PickerCard,
} from './keyboards/keyboards.js';
import type { IncomingUpdate, TelegramSender } from './protocol.js';
import { COPY } from './views/copy.js';
import { renderArchivedList, renderFrozenCard } from './views/cards.view.js';
import { paginateText, renderDashboard } from './views/dashboard.view.js';
import type { CardRow } from '../../application/ports/card-repository.js';
import { isStartCommand } from './handlers/start.js';

const NOT_FOUND = COPY.notFound;

function sameState(left: DialogState, right: DialogState): boolean {
  return JSON.stringify(serializeDialogState(left)) === JSON.stringify(serializeDialogState(right));
}

function parseCallbackCardId(raw: string): CardId | null {
  if (!/^[1-9]\d*$/u.test(raw)) {
    return null;
  }
  try {
    return cardId(Number(raw));
  } catch {
    return null;
  }
}

function pickerFromDashboard(dashboard: Dashboard): { working: PickerCard[]; frozen: PickerCard[] } {
  return {
    working: dashboard.workingCards.map((card) => ({
      id: card.id,
      name: card.name,
      balance: card.balance,
    })),
    frozen: dashboard.frozenCards.map((card) => ({
      id: card.id,
      name: card.name,
      balance: card.balance,
    })),
  };
}

function toPicker(row: CardRow, balance: Money | undefined): PickerCard {
  const item: PickerCard = { id: row.id, name: row.name };
  if (balance !== undefined) {
    return { ...item, balance };
  }
  return item;
}

function balanceMap(dashboard: Dashboard): Map<CardId, Money> {
  const map = new Map<CardId, Money>();
  for (const card of [...dashboard.workingCards, ...dashboard.frozenCards]) {
    map.set(card.id, card.balance);
  }
  return map;
}

async function send(
  sender: TelegramSender,
  text: string,
  keyboard?: Keyboard,
  parseMode?: 'HTML',
): Promise<void> {
  const pages = paginateText(text);
  const last = pages.length - 1;
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    if (page === undefined) {
      continue;
    }
    if (i === last && keyboard !== undefined) {
      await sender.sendMessage(page, keyboard, parseMode);
    } else {
      await sender.sendMessage(page, undefined, parseMode);
    }
  }
}

function ackCallback(
  deps: TelegramDeps,
  userId: UserId,
  correlationId: string,
  update: IncomingUpdate,
  sender: TelegramSender,
): Promise<void> {
  if (update.kind !== 'callback') {
    return Promise.resolve();
  }
  return sender.answerCallback().catch((error: unknown) => {
    deps.logger.warn(
      { userId, correlationId, updateId: update.updateId },
      `answerCallback failed: ${String(error)}`,
    );
  });
}

async function loadUser(deps: TelegramDeps, telegramId: string): Promise<UserRecord> {
  return deps.uow.withTelegramIdentity(telegramId, (tx: DbTx) =>
    deps.users.findOrCreateByTelegramId(telegramId, tx),
  );
}

async function claimUpdate(deps: TelegramDeps, userId: UserId, updateId: number): Promise<boolean> {
  return deps.uow.withUser(userId, (tx: DbTx) => deps.processed.claim(userId, String(updateId), tx));
}

async function readDialog(deps: TelegramDeps, userId: UserId, now: Date) {
  const record = await deps.uow.withUser(userId, (tx: DbTx) => deps.dialogs.getUserDialogState(userId, tx));
  return loadDialog(record, now);
}

async function writeDialog(deps: TelegramDeps, userId: UserId, state: DialogState, now: Date) {
  return deps.uow.withUser(userId, (tx: DbTx) =>
    deps.dialogs.upsertUserDialogState(userId, toUpsert(state, dialogExpiresAt(now)), tx),
  );
}

async function ownedCard(deps: TelegramDeps, userId: UserId, id: CardId): Promise<CardRow | null> {
  return deps.services.card.getUserCard(userId, id);
}

function todayOf(deps: TelegramDeps, user: UserRecord): BusinessDate {
  return deps.clock.businessDate(user.tz);
}

/**
 * Обработка апдейта без grammY. Тестируется через фейковый транспорт.
 */
export async function handleIncoming(
  deps: TelegramDeps,
  update: IncomingUpdate,
  sender: TelegramSender,
): Promise<void> {
  const correlationId = `upd-${String(update.updateId)}`;
  const user = await loadUser(deps, update.telegramId);
  const claimed = await claimUpdate(deps, user.id, update.updateId);
  if (!claimed) {
    deps.logger.info({ userId: user.id, correlationId, updateId: update.updateId }, 'duplicate update');
    return;
  }

  const ack = ackCallback(deps, user.id, correlationId, update, sender);
  try {
    await handleClaimed(deps, user, update, sender, correlationId);
  } finally {
    await ack;
  }
}

async function handleClaimed(
  deps: TelegramDeps,
  user: UserRecord,
  update: IncomingUpdate,
  sender: TelegramSender,
  correlationId: string,
): Promise<void> {
  const now = deps.clock.now();
  const loaded = await readDialog(deps, user.id, now);
  const state = loaded.state;
  let stateRev = loaded.stateRev;

  if (loaded.expired) {
    const { next, effects } = reduce(state, { t: 'Expired' });
    const saved = await writeDialog(deps, user.id, next, now);
    await runEffects(deps, user, sender, next, effects, saved.stateRev, correlationId);
    return;
  }

  let event: DialogEvent;
  try {
    event = await classify(deps, user, state, stateRev, update);
  } catch (error) {
    if (error instanceof StaleCallbackError) {
      event = { t: 'Stale' };
    } else if (error instanceof ValidationError) {
      await send(sender, error.message, cancelKeyboard(stateRev));
      return;
    } else {
      throw error;
    }
  }

  const reduced = reduce(state, event);
  const mutations = reduced.effects.filter((effect) => isMutation(effect.t));
  const views = reduced.effects.filter((effect) => !isMutation(effect.t));

  if (mutations.some((effect) => effect.t === 'BuildReport')) {
    try {
      const file = await deps.report.build(user.id, todayOf(deps, user));
      const saved = await writeDialog(deps, user.id, IDLE, now);
      await sender.sendDocument(file, 'izicrm-report.xlsx');
      await sendHome(deps, user, sender, saved.stateRev);
    } catch (error) {
      const saved = await writeDialog(deps, user.id, IDLE, now);
      const message = error instanceof ValidationError ? error.message : COPY.reportUnavailable;
      await send(sender, message);
      await sendHome(deps, user, sender, saved.stateRev);
    }
    return;
  }

  try {
    await runEffects(deps, user, sender, reduced.next, mutations, stateRev, correlationId);
  } catch (error) {
    await handleEffectError(deps, user, sender, state, stateRev, error, correlationId);
    return;
  }

  const persist = !sameState(state, reduced.next);
  if (persist) {
    const saved = await writeDialog(deps, user.id, reduced.next, now);
    stateRev = saved.stateRev;
  }

  const shouldShowHome =
    reduced.next.t === 'Idle' &&
    mutations.length > 0 &&
    views.every((effect) => effect.t === 'Ignore');
  const visual: Effect[] = shouldShowHome ? [...views, { t: 'ShowHome' }] : views;
  await runEffects(deps, user, sender, reduced.next, visual, stateRev, correlationId);
}

function isMutation(tag: Effect['t']): boolean {
  return (
    tag === 'CreateCard' ||
    tag === 'ApplyTopUp' ||
    tag === 'ApplyFreeze' ||
    tag === 'ApplySpend' ||
    tag === 'ApplyUnfreeze' ||
    tag === 'ApplyUpdate' ||
    tag === 'ApplyArchive' ||
    tag === 'BuildReport'
  );
}

async function handleEffectError(
  deps: TelegramDeps,
  user: UserRecord,
  sender: TelegramSender,
  state: DialogState,
  rev: number,
  error: unknown,
  correlationId: string,
): Promise<void> {
  if (error instanceof ValidationError) {
    await send(sender, error.message, cancelKeyboard(rev));
    return;
  }
  if (error instanceof ConflictError) {
    await send(sender, COPY.nameTaken, cancelKeyboard(rev));
    return;
  }
  if (error instanceof NotFoundError) {
    deps.logger.warn({ userId: user.id, correlationId, state: state.t }, 'card not found');
    await send(sender, NOT_FOUND);
    return;
  }
  deps.logger.error({ userId: user.id, correlationId, err: String(error) }, 'effect failed');
  await send(sender, COPY.genericError);
}

async function classify(
  deps: TelegramDeps,
  user: UserRecord,
  state: DialogState,
  stateRev: number,
  update: IncomingUpdate,
): Promise<DialogEvent> {
  if (update.kind === 'message') {
    return classifyText(deps, user, state, update.text);
  }
  return classifyCallback(deps, user, state, stateRev, update.data);
}

async function classifyText(
  deps: TelegramDeps,
  user: UserRecord,
  state: DialogState,
  text: string,
): Promise<DialogEvent> {
  if (isStartCommand(text)) {
    return { t: 'Start' };
  }
  switch (state.t) {
    case 'CardCreateName':
      return classifyName(deps, user, text);
    case 'CardCreateBalance':
    case 'TopUpAmount':
    case 'SpendAmount':
    case 'BalanceUpdateAmount':
      return classifyAmount(deps, user, state, text);
    default:
      return { t: 'Home' };
  }
}

async function classifyName(deps: TelegramDeps, user: UserRecord, text: string): Promise<DialogEvent> {
  try {
    assertCardName(text);
  } catch (error) {
    if (error instanceof ValidationError) {
      return { t: 'NameInvalid', message: error.message };
    }
    throw error;
  }
  const taken = await deps.uow.withUser(user.id, (tx: DbTx) =>
    deps.cards.findActiveByNormalizedName(user.id, normalizeCardName(text), tx),
  );
  if (taken !== null) {
    return { t: 'NameDuplicate' };
  }
  return { t: 'NameEntered', name: text.trim() };
}

async function classifyAmount(
  deps: TelegramDeps,
  user: UserRecord,
  state: DialogState,
  text: string,
): Promise<DialogEvent> {
  let amount: Money;
  try {
    amount = parseAmount(text);
  } catch (error) {
    if (error instanceof ValidationError) {
      return { t: 'AmountInvalid', message: error.message };
    }
    throw error;
  }
  let name = '';
  let previous: string | undefined;
  if (state.t === 'BalanceUpdateAmount') {
    const id = state.queue[state.index];
    if (id !== undefined) {
      const locf = await deps.services.balanceUpdate.previousBalance(user.id, id, state.businessDate);
      name = locf.card.name;
      previous = locf.amount.toFixed();
    }
  }
  if (state.t === 'TopUpAmount' || state.t === 'SpendAmount') {
    const card = await ownedCard(deps, user.id, state.cardId);
    name = card?.name ?? '';
  }
  if (state.t === 'CardCreateBalance') {
    name = state.name;
  }
  if (previous === undefined) {
    return { t: 'AmountEntered', amount: amount.toFixed(), name };
  }
  return { t: 'AmountEntered', amount: amount.toFixed(), name, previous };
}

async function classifyCallback(
  deps: TelegramDeps,
  user: UserRecord,
  state: DialogState,
  stateRev: number,
  data: string,
): Promise<DialogEvent> {
  const parsed = parseCallbackData(data);
  if (!parsed.ok) {
    if (parsed.reason === 'unknown_version') {
      return { t: 'Home' };
    }
    return { t: 'Home' };
  }
  assertFreshRev(stateRev, parsed.rev);

  const today = todayOf(deps, user);
  const action = parsed.action;
  const id = parsed.id;

  switch (action) {
    case 'home':
      return { t: 'Home' };
    case 'cancel':
      return { t: 'Cancel' };
    case 'settings':
      return { t: 'Settings' };
    case 'report':
      if (!deps.reportLimit.tryAcquire(user.id, deps.clock.now())) {
        throw new ValidationError(COPY.reportRateLimit);
      }
      return { t: 'Report' };
    case 'topup':
      return { t: 'TopUpMenu' };
    case 'card_add':
      return { t: 'CardAdd' };
    case 'topup_pick':
      return { t: 'TopUpPick' };
    case 'expense':
      return { t: 'ExpenseMenu' };
    case 'freeze_pick':
      return { t: 'FreezePick' };
    case 'spend_pick':
      return { t: 'SpendPick' };
    case 'unfreeze_pick':
      return { t: 'UnfreezePick' };
    case 'upd_all': {
      const queue = await deps.services.balanceUpdate.listWorkingQueue(user.id, today);
      return { t: 'UpdateAll', queue: queue.map((row) => row.id), businessDate: today };
    }
    case 'skip':
      if (state.t === 'BalanceUpdateAmount') {
        const current = state.queue[state.index];
        if (current === undefined) {
          return { t: 'Home' };
        }
        const locf = await deps.services.balanceUpdate.previousBalance(user.id, current, state.businessDate);
        return { t: 'Skip', name: locf.card.name, previous: locf.amount.toFixed() };
      }
      return { t: 'Home' };
    case 'arch_pick':
      return { t: 'ArchivePick' };
    case 'arch_list':
      return { t: 'ArchiveList' };
    case 'yes':
      return classifyArchiveYes(deps, user, state, today);
    case 'withdrawn':
      return { t: 'Withdrawn' };
    case 'lost':
      return { t: 'Lost' };
    case 'transferred':
      return { t: 'Transferred' };
    case 'page':
      return { t: 'Home' };
    default:
      return classifyCardCallback(deps, user, action, id, today);
  }
}

async function classifyArchiveYes(
  deps: TelegramDeps,
  user: UserRecord,
  state: DialogState,
  today: BusinessDate,
): Promise<DialogEvent> {
  if (state.t !== 'ArchiveConfirm') {
    return { t: 'Home' };
  }
  const preview = await deps.services.archive.preview(user.id, state.cardId, today);
  return {
    t: 'ArchiveYes',
    needsDisposition: preview.needsDisposition,
    remainder: preview.remainder.toFixed(),
    name: preview.name,
  };
}

async function classifyCardCallback(
  deps: TelegramDeps,
  user: UserRecord,
  action: CallbackAction,
  rawId: string,
  today: BusinessDate,
): Promise<DialogEvent> {
  const id = parseCallbackCardId(rawId);
  if (id === null) {
    deps.logger.warn({ userId: user.id, correlationId: 'cb', action }, 'invalid card id');
    return { t: 'NotFound' };
  }
  const card = await ownedCard(deps, user.id, id);
  if (card === null) {
    deps.logger.warn({ userId: user.id, correlationId: 'cb', action, cardId: id }, 'foreign or missing card');
    return { t: 'NotFound' };
  }

  switch (action) {
    case 'topup_card':
      if (!isWorking(card, today)) {
        return { t: 'NotFound' };
      }
      return { t: 'TopUpCard', cardId: id, businessDate: today };
    case 'freeze':
      if (!isWorking(card, today)) {
        return { t: 'NotFound' };
      }
      return { t: 'FreezeCard', cardId: id };
    case 'spend_card':
      if (!isInScope(card, today)) {
        return { t: 'NotFound' };
      }
      return { t: 'SpendCard', cardId: id, businessDate: today };
    case 'frozen':
      if (!isFrozen(card) || !isInScope(card, today)) {
        return { t: 'NotFound' };
      }
      return { t: 'FrozenMenu', cardId: id };
    case 'unfreeze':
      return { t: 'Unfreeze', cardId: id };
    case 'upd_one':
      if (!isInScope(card, today)) {
        return { t: 'NotFound' };
      }
      return { t: 'UpdateOne', cardId: id, businessDate: today };
    case 'card_archive':
      if (!isInScope(card, today)) {
        return { t: 'NotFound' };
      }
      return { t: 'Archive', cardId: id };
    case 'target':
      return { t: 'ArchiveTarget', cardId: id };
    default:
      return { t: 'Home' };
  }
}

async function runEffects(
  deps: TelegramDeps,
  user: UserRecord,
  sender: TelegramSender,
  state: DialogState,
  effects: Effect[],
  rev: number,
  correlationId: string,
): Promise<void> {
  for (const effect of effects) {
    await runEffect(deps, user, sender, state, effect, rev, correlationId);
  }
}

async function runEffect(
  deps: TelegramDeps,
  user: UserRecord,
  sender: TelegramSender,
  state: DialogState,
  effect: Effect,
  rev: number,
  correlationId: string,
): Promise<void> {
  const today = todayOf(deps, user);
  switch (effect.t) {
    case 'ShowHome':
      await sendHome(deps, user, sender, rev);
      return;
    case 'ShowSettings':
      await send(sender, COPY.settingsTitle, settingsKeyboard(rev));
      return;
    case 'ShowTopUpMenu':
      await send(sender, COPY.topUpMenu, topUpMenuKeyboard(rev));
      return;
    case 'ShowExpenseMenu':
      await send(sender, COPY.expenseMenu, expenseMenuKeyboard(rev));
      return;
    case 'ShowArchived': {
      const archived = await deps.services.card.listArchived(user.id);
      await send(sender, renderArchivedList(archived), cancelKeyboard(rev));
      return;
    }
    case 'PromptName':
      await send(sender, COPY.promptName, cancelKeyboard(rev));
      return;
    case 'PromptBalance':
      await send(
        sender,
        `${COPY.promptBalance(effect.name)}\n\n${COPY.createHint}`,
        cancelKeyboard(rev),
      );
      return;
    case 'CreateCard': {
      await deps.services.card.create(user.id, {
        name: effect.name,
        amount: Money.from(effect.amount),
        createdOn: today,
      });
      return;
    }
    case 'NameTaken':
      await send(sender, COPY.nameTaken, cancelKeyboard(rev));
      return;
    case 'InvalidInput':
      await send(sender, effect.message, cancelKeyboard(rev));
      return;
    case 'ShowTopUpList':
    case 'ShowFreezeList':
    case 'ShowSpendList':
    case 'ShowUnfreezeList':
    case 'ShowArchiveList':
    case 'ShowArchiveTargets':
      await sendPicker(deps, user, sender, effect.t, state, rev, today);
      return;
    case 'PromptTopUp':
    case 'PromptSpend':
      await sendAmountPrompt(deps, user, sender, state, effect.t, rev);
      return;
    case 'ApplyTopUp': {
      const applied = await deps.services.topup.topUp(user.id, {
        cardId: effect.cardId,
        newAmount: Money.from(effect.amount),
        businessDate: effect.businessDate,
      });
      if (applied.applied) {
        const card = await ownedCard(deps, user.id, effect.cardId);
        await send(
          sender,
          COPY.topUpDone(
            formatMoney(applied.value.delta),
            card?.name ?? '',
            formatMoney(Money.from(effect.amount)),
          ),
        );
      }
      return;
    }
    case 'ApplySpend': {
      const applied = await deps.services.spend.spend(user.id, {
        cardId: effect.cardId,
        newAmount: Money.from(effect.amount),
        businessDate: effect.businessDate,
      });
      if (applied.applied) {
        const card = await ownedCard(deps, user.id, effect.cardId);
        await send(
          sender,
          COPY.spendDone(
            formatMoney(applied.value.delta),
            card?.name ?? '',
            formatMoney(Money.from(effect.amount)),
          ),
        );
      }
      return;
    }
    case 'ApplyFreeze': {
      await deps.services.freeze.freeze(user.id, { cardId: effect.cardId, frozenOn: today });
      const card = await ownedCard(deps, user.id, effect.cardId);
      await send(sender, COPY.freezeDone(card?.name ?? ''));
      return;
    }
    case 'ApplyUnfreeze': {
      await deps.services.freeze.unfreeze(user.id, { cardId: effect.cardId });
      const card = await ownedCard(deps, user.id, effect.cardId);
      await send(sender, COPY.unfreezeDone(card?.name ?? ''));
      return;
    }
    case 'ShowFrozenMenu': {
      const card = await ownedCard(deps, user.id, effect.cardId);
      if (card === null) {
        await send(sender, NOT_FOUND);
        return;
      }
      const locf = await deps.services.balanceUpdate.previousBalance(user.id, card.id, today);
      await send(
        sender,
        renderFrozenCard(card.name, locf.amount),
        frozenCardKeyboard(card.id, rev),
      );
      return;
    }
    case 'PromptUpdate':
      await sendUpdatePrompt(deps, user, sender, state, rev);
      return;
    case 'ApplyUpdate':
      await deps.services.balanceUpdate.update(user.id, {
        cardId: effect.cardId,
        amount: Money.from(effect.amount),
        businessDate: effect.businessDate,
      });
      return;
    case 'PromptArchiveConfirm': {
      const preview = await deps.services.archive.preview(user.id, effect.cardId, today);
      const text = preview.needsDisposition
        ? COPY.archiveConfirm(preview.name, formatMoney(preview.remainder))
        : COPY.archiveConfirmZero(preview.name);
      await send(sender, text, archiveConfirmKeyboard(rev));
      return;
    }
    case 'PromptDisposition':
      await send(
        sender,
        COPY.dispositionPrompt(effect.name, formatMoney(Money.from(effect.remainder))),
        dispositionKeyboard(rev, formatMoney(Money.from(effect.remainder))),
      );
      return;
    case 'ApplyArchive': {
      await deps.services.archive.archive(user.id, {
        cardId: effect.cardId,
        archivedOn: today,
        reason: effect.reason,
        ...(effect.targetCardId === undefined ? {} : { targetCardId: effect.targetCardId }),
      });
      await send(sender, COPY.archivedDone);
      return;
    }
    case 'BuildReport':
      await runReport(deps, user, sender, rev, today);
      return;
    case 'ReportUnavailable':
      await send(sender, effect.message);
      return;
    case 'NotFound':
      deps.logger.warn({ userId: user.id, correlationId }, 'material not found');
      await send(sender, NOT_FOUND);
      return;
    case 'Stale':
      await send(sender, COPY.stale);
      await sendHome(deps, user, sender, rev);
      return;
    case 'Expired':
      await send(sender, COPY.expired);
      await sendHome(deps, user, sender, rev);
      return;
    case 'NoWorkingCards':
      await send(sender, COPY.noWorking, noWorkingKeyboard(rev));
      return;
    case 'Ignore':
      return;
  }
}

async function sendHome(
  deps: TelegramDeps,
  user: UserRecord,
  sender: TelegramSender,
  rev: number,
): Promise<void> {
  const dashboard = await deps.services.dashboard.getDashboard(user.id, todayOf(deps, user));
  await send(
    sender,
    renderDashboard(dashboard),
    dashboardKeyboard(rev, pickerFromDashboard(dashboard)),
    'HTML',
  );
}

async function sendPicker(
  deps: TelegramDeps,
  user: UserRecord,
  sender: TelegramSender,
  kind: Effect['t'],
  state: DialogState,
  rev: number,
  today: BusinessDate,
): Promise<void> {
  const dashboard = await deps.services.dashboard.getDashboard(user.id, today);
  const amounts = balanceMap(dashboard);
  if (kind === 'ShowTopUpList') {
    const rows = await deps.services.topup.listTopUpable(user.id, today);
    if (rows.length === 0) {
      await send(sender, COPY.noWorking, noWorkingKeyboard(rev));
      return;
    }
    await send(
      sender,
      COPY.pickMaterial,
      cardPickerKeyboard(
        rows.map((row) => toPicker(row, amounts.get(row.id))),
        'topup_card',
        rev,
        { back: 'topup' },
      ),
    );
    return;
  }
  if (kind === 'ShowFreezeList') {
    const rows = await deps.services.freeze.listFreezable(user.id, today);
    if (rows.length === 0) {
      await send(sender, COPY.noWorking, noWorkingKeyboard(rev));
      return;
    }
    await send(
      sender,
      COPY.freezeWhich,
      cardPickerKeyboard(
        rows.map((row) => toPicker(row, amounts.get(row.id))),
        'freeze',
        rev,
        { back: 'expense' },
      ),
    );
    return;
  }
  if (kind === 'ShowSpendList') {
    const rows = await deps.services.spend.listSpendable(user.id, today);
    await send(
      sender,
      COPY.pickMaterial,
      cardPickerKeyboard(
        rows.map((row) => toPicker(row, amounts.get(row.id))),
        'spend_card',
        rev,
        { back: 'expense' },
      ),
    );
    return;
  }
  if (kind === 'ShowUnfreezeList') {
    const rows = dashboard.frozenCards;
    if (rows.length === 0) {
      await send(sender, COPY.noFrozen, cardPickerKeyboard([], 'frozen', rev, { back: 'expense' }));
      return;
    }
    await send(
      sender,
      COPY.unfreezeWhich,
      cardPickerKeyboard(
        rows.map((card) => ({
          id: card.id,
          name: card.name,
          balance: card.balance,
        })),
        'frozen',
        rev,
        { back: 'expense' },
      ),
    );
    return;
  }
  if (kind === 'ShowArchiveList') {
    const cards = [...dashboard.workingCards, ...dashboard.frozenCards];
    await send(
      sender,
      COPY.pickMaterial,
      cardPickerKeyboard(
        cards.map((card) => ({ id: card.id, name: card.name, balance: card.balance })),
        'card_archive',
        rev,
        { back: 'settings' },
      ),
    );
    return;
  }
  if (kind === 'ShowArchiveTargets' && state.t === 'ArchiveTarget') {
    const rows = await deps.services.archive.listTransferTargets(user.id, state.cardId, today);
    await send(
      sender,
      COPY.pickTarget,
      cardPickerKeyboard(
        rows.map((row) => toPicker(row, amounts.get(row.id))),
        'target',
        rev,
      ),
    );
  }
}

async function sendAmountPrompt(
  deps: TelegramDeps,
  user: UserRecord,
  sender: TelegramSender,
  state: DialogState,
  kind: 'PromptTopUp' | 'PromptSpend',
  rev: number,
): Promise<void> {
  if (state.t !== 'TopUpAmount' && state.t !== 'SpendAmount') {
    return;
  }
  const locf = await deps.services.balanceUpdate.previousBalance(user.id, state.cardId, state.businessDate);
  const current = formatMoney(locf.amount);
  const text =
    kind === 'PromptTopUp'
      ? COPY.promptTopUp(locf.card.name, current)
      : COPY.promptSpend(locf.card.name, current);
  await send(sender, text, cancelKeyboard(rev));
}

async function sendUpdatePrompt(
  deps: TelegramDeps,
  user: UserRecord,
  sender: TelegramSender,
  state: DialogState,
  rev: number,
): Promise<void> {
  if (state.t !== 'BalanceUpdateAmount') {
    return;
  }
  const id = state.queue[state.index];
  if (id === undefined) {
    return;
  }
  const locf = await deps.services.balanceUpdate.previousBalance(user.id, id, state.businessDate);
  await send(
    sender,
    COPY.promptUpdate(locf.card.name, state.index + 1, state.queue.length, formatMoney(locf.amount)),
    updatePromptKeyboard(rev),
  );
}

async function runReport(
  deps: TelegramDeps,
  user: UserRecord,
  sender: TelegramSender,
  rev: number,
  today: BusinessDate,
): Promise<void> {
  await send(sender, COPY.reportWait);
  try {
    const file = await deps.report.build(user.id, today);
    await sender.sendDocument(file, 'izicrm-report.xlsx');
  } catch (error) {
    const message = error instanceof ValidationError ? error.message : COPY.reportUnavailable;
    await send(sender, message);
  }
  await sendHome(deps, user, sender, rev);
}
