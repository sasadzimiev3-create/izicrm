import { CARD_ICONS } from '../../../application/dto/card-icon.js';
import { formatMoney } from '../../../domain/money/format.js';
import type { CardId } from '../../../domain/cards/card.js';
import type { Money } from '../../../domain/money/money.js';

import { encodeCallback, type CallbackAction } from './callback-data.js';
import { COPY } from '../views/copy.js';
import { formatCardTitle } from '../views/dashboard.view.js';

export type KeyboardButton = { text: string; data: string };
export type Keyboard = KeyboardButton[][];

function btn(text: string, action: CallbackAction, id: string | number | null, rev: number): KeyboardButton {
  return { text, data: encodeCallback(action, id, rev) };
}

function cancelRow(rev: number): KeyboardButton[] {
  return [btn(COPY.cancel, 'cancel', null, rev)];
}

function backRow(rev: number): KeyboardButton[] {
  return [btn(`◀️ ${COPY.back}`, 'home', null, rev)];
}

function truncate(text: string, max = 64): string {
  const chars = [...text];
  if (chars.length <= max) {
    return text;
  }
  return `${chars.slice(0, max - 1).join('')}…`;
}

export function mainKeyboard(
  rev: number,
  opts: { empty?: boolean; page?: number; hasPrev?: boolean; hasNext?: boolean } = {},
): Keyboard {
  if (opts.empty === true) {
    return [[btn('➕ Пополнить', 'topup', null, rev)]];
  }
  const rows: Keyboard = [
    [btn('🔄 Обновить балансы', 'upd_all', null, rev)],
    [btn('➕ Пополнить', 'topup', null, rev), btn('❄️ Расход', 'expense', null, rev)],
    [btn('⚙️ Настройки', 'settings', null, rev)],
  ];
  const nav: KeyboardButton[] = [];
  if (opts.hasPrev === true && opts.page !== undefined) {
    nav.push(btn('◀️', 'page', opts.page - 1, rev));
  }
  if (opts.hasNext === true && opts.page !== undefined) {
    nav.push(btn('▶️', 'page', opts.page + 1, rev));
  }
  if (nav.length > 0) {
    rows.push(nav);
  }
  return rows;
}

export function cancelKeyboard(rev: number): Keyboard {
  return [cancelRow(rev)];
}

export function updatePromptKeyboard(rev: number): Keyboard {
  return [[btn(`⏭ ${COPY.skip}`, 'skip', null, rev), btn(COPY.cancel, 'cancel', null, rev)]];
}

export function topUpMenuKeyboard(rev: number): Keyboard {
  return [
    [btn(`➕ ${COPY.addMaterial}`, 'card_add', null, rev)],
    [btn(`💵 ${COPY.topUpExisting}`, 'topup_pick', null, rev)],
    backRow(rev),
  ];
}

export function expenseMenuKeyboard(rev: number): Keyboard {
  return [
    [btn(`❄️ ${COPY.freezePick}`, 'freeze_pick', null, rev)],
    [btn(`💸 ${COPY.spendPick}`, 'spend_pick', null, rev)],
    [btn(`♻️ ${COPY.returnToWork}`, 'unfreeze_pick', null, rev)],
    backRow(rev),
  ];
}

export function settingsKeyboard(rev: number): Keyboard {
  return [
    [btn(`📊 ${COPY.report}`, 'report', null, rev)],
    [btn(`✏️ ${COPY.renameMaterial}`, 'rename_pick', null, rev)],
    [btn(`🎨 ${COPY.changeSticker}`, 'icon_pick', null, rev)],
    [btn(`🗑 ${COPY.deleteMaterial}`, 'arch_pick', null, rev)],
    [btn(`📁 ${COPY.archiveMaterials}`, 'arch_list', null, rev)],
    backRow(rev),
  ];
}

export type PickerCard = {
  id: CardId;
  name: string;
  icon: string | null;
  balance?: Money;
};

export function cardPickerKeyboard(
  cards: PickerCard[],
  action: CallbackAction,
  rev: number,
  opts: { back?: CallbackAction } = {},
): Keyboard {
  const rows: Keyboard = cards.map((card) => {
    const balance = card.balance === undefined ? '' : `  · ${formatMoney(card.balance)}`;
    return [btn(truncate(`${formatCardTitle(card.icon, card.name)}${balance}`), action, card.id, rev)];
  });
  rows.push([btn(`◀️ ${COPY.back}`, opts.back ?? 'home', null, rev)]);
  return rows;
}

export function iconKeyboard(rev: number): Keyboard {
  const icons: KeyboardButton[] = CARD_ICONS.map((icon, index) => btn(icon, 'icon', index, rev));
  const rowSize = 3;
  const rows: Keyboard = [];
  for (let i = 0; i < icons.length; i += rowSize) {
    rows.push(icons.slice(i, i + rowSize));
  }
  rows.push([btn(`⏭ ${COPY.skipSticker}`, 'skip', null, rev), btn(COPY.cancel, 'cancel', null, rev)]);
  return rows;
}

export function frozenCardKeyboard(cardId: CardId, rev: number): Keyboard {
  return [
    [btn(`♻️ ${COPY.returnToWork}`, 'unfreeze', cardId, rev)],
    [btn(`🔄 ${COPY.updateBalance}`, 'upd_one', cardId, rev)],
    backRow(rev),
  ];
}

export function archiveConfirmKeyboard(rev: number): Keyboard {
  return [[btn(COPY.yes, 'yes', null, rev)], cancelRow(rev)];
}

export function dispositionKeyboard(rev: number, remainder: string): Keyboard {
  return [
    [btn(`↔️ ${COPY.transferred}`, 'transferred', null, rev)],
    [btn(`💸 ${COPY.withdrawn}`, 'withdrawn', null, rev)],
    [btn(`📉 ${COPY.lost(remainder)}`, 'lost', null, rev)],
    cancelRow(rev),
  ];
}

export function noWorkingKeyboard(rev: number): Keyboard {
  return [[btn(`➕ ${COPY.addMaterial}`, 'card_add', null, rev)], backRow(rev)];
}

export function dashboardKeyboard(
  rev: number,
  cards: { working: PickerCard[]; frozen: PickerCard[] },
): Keyboard {
  const empty = cards.working.length === 0 && cards.frozen.length === 0;
  return mainKeyboard(rev, { empty });
}

export function toInlineMarkup(keyboard: Keyboard): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  return {
    inline_keyboard: keyboard.map((row) =>
      row.map((button) => ({ text: button.text, callback_data: button.data })),
    ),
  };
}
