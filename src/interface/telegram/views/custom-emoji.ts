import { detectBankKind, type BankKind } from '../../../domain/cards/bank-emoji.js';

/** Запасной символ для маркера материала и «В работе». */
export const CARD_EMOJI = '\u{1F4B3}';

const MONTH_FALLBACK = '\u{1F4C5}';
const TODAY_FALLBACK = '\u{1F4CA}';

/**
 * Premium custom emoji главного экрана.
 *
 * @see docs/telegram-flows.md §1.3
 */
export const CUSTOM_EMOJI_ID = {
  sber: '5325860941412192758',
  vtb: '5368752026723304143',
  alfa: '5395449620744647196',
  otp: '5391292582028404762',
  tbank: '5300890611438610103',
  working: '5445353829304387411',
  month: '5334559435597560442',
  today: '5352970667610349580',
} as const;

const BANK_CUSTOM_EMOJI_ID: Record<Exclude<BankKind, 'other'>, string> = {
  sber: CUSTOM_EMOJI_ID.sber,
  vtb: CUSTOM_EMOJI_ID.vtb,
  alfa: CUSTOM_EMOJI_ID.alfa,
  otp: CUSTOM_EMOJI_ID.otp,
  tbank: CUSTOM_EMOJI_ID.tbank,
};

export function tgCustomEmoji(id: string, fallback: string): string {
  return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
}

export function bankMarkerHtml(name: string): string {
  const kind = detectBankKind(name);
  if (kind === 'other') {
    return CARD_EMOJI;
  }
  return tgCustomEmoji(BANK_CUSTOM_EMOJI_ID[kind], CARD_EMOJI);
}

export function workingMarkerHtml(): string {
  return tgCustomEmoji(CUSTOM_EMOJI_ID.working, CARD_EMOJI);
}

export function monthMarkerHtml(): string {
  return tgCustomEmoji(CUSTOM_EMOJI_ID.month, MONTH_FALLBACK);
}

export function todayMarkerHtml(): string {
  return tgCustomEmoji(CUSTOM_EMOJI_ID.today, TODAY_FALLBACK);
}
