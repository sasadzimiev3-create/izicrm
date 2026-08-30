import { formatMoney } from '../../../domain/money/format.js';
import type { CardId } from '../../../domain/cards/card.js';
import type { Money } from '../../../domain/money/money.js';

import { encodeCallback, type CallbackAction } from './callback-data.js';
import { COPY } from '../views/copy.js';
import { formatCardTitle } from '../views/dashboard.view.js';

export type KeyboardButtonStyle = 'primary' | 'success' | 'danger';
export type KeyboardButton =
  | { text: string; data: string; style?: KeyboardButtonStyle }
  | { text: string; url: string };
export type Keyboard = KeyboardButton[][];

function btn(
  text: string,
  action: CallbackAction,
  id: string | number | null,
  rev: number,
  style?: KeyboardButtonStyle,
): KeyboardButton {
  const button: KeyboardButton = { text, data: encodeCallback(action, id, rev) };
  if (style === undefined) {
    return button;
  }
  return { ...button, style };
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
    return [[btn(COPY.topUpMenu, 'topup', null, rev, 'success')]];
  }
  const rows: Keyboard = [
    [btn('🔄 Обновить балансы', 'upd_all', null, rev)],
    [
      btn(COPY.topUpMenu, 'topup', null, rev, 'success'),
      btn(COPY.expenseMenu, 'expense', null, rev, 'danger'),
    ],
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
    [btn(`💻 ${COPY.webCabinet}`, 'web', null, rev)],
    [btn(`📊 ${COPY.report}`, 'report', null, rev)],
    [btn(`🗑 ${COPY.deleteMaterial}`, 'arch_pick', null, rev)],
    [btn(`📁 ${COPY.archiveMaterials}`, 'arch_list', null, rev)],
    backRow(rev),
  ];
}

export function webLinkKeyboard(url: string, rev: number): Keyboard {
  return [[{ text: COPY.webOpen, url }], backRow(rev)];
}

export type PickerCard = {
  id: CardId;
  name: string;
  balance?: Money;
};

export function cardPickerKeyboard(
  cards: PickerCard[],
  action: CallbackAction,
  rev: number,
  opts: { back?: CallbackAction } = {},
): Keyboard {
  const rows: Keyboard = cards.map((card) => {
    const balance = card.balance === undefined ? '' : ` ${'\u2014'} ${formatMoney(card.balance)}`;
    return [btn(truncate(`${formatCardTitle(card.name)}${balance}`), action, card.id, rev)];
  });
  rows.push([btn(`◀️ ${COPY.back}`, opts.back ?? 'home', null, rev)]);
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
  inline_keyboard: (
    | { text: string; callback_data: string; style?: KeyboardButtonStyle }
    | { text: string; url: string }
  )[][];
} {
  return {
    inline_keyboard: keyboard.map((row) =>
      row.map((button) => {
        if ('url' in button) {
          return { text: button.text, url: button.url };
        }
        if (button.style === undefined) {
          return { text: button.text, callback_data: button.data };
        }
        return { text: button.text, callback_data: button.data, style: button.style };
      }),
    ),
  };
}
