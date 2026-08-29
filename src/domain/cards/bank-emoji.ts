/**
 * Банк по названию материала.
 * Подстрока, регистр, дефис и пробелы не важны: «Втб2312» → vtb.
 *
 * Неизвестные банки — 💳. Ручного выбора нет (C-20).
 */
export type BankKind = 'sber' | 'vtb' | 'alfa' | 'otp' | 'tbank' | 'other';

const GREEN = '🟢';
const YELLOW = '🟡';
const BLUE = '🔵';
const RED = '🔴';
const ORANGE = '🟠';
const CARD = '\u{1F4B3}';

function foldName(name: string): string {
  return name.toLowerCase().replaceAll('ё', 'е');
}

function spacedName(folded: string): string {
  return folded.replace(/[-_./]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function compactName(spaced: string): string {
  return spaced.replace(/ /g, '');
}

function isTBank(spaced: string, compact: string): boolean {
  if (/тинькофф|тинькоф|tinkoff|tinkof/.test(compact)) {
    return true;
  }
  if (/^(?:т|t)(?:банк|bank)/.test(compact)) {
    return true;
  }
  if (/(?:^|\s)(?:т|t)\s+(?:банк|bank)(?:\s|$)/.test(spaced)) {
    return true;
  }
  if (/^(?:т|t)$/.test(compact)) {
    return true;
  }
  return /^(?:т|t)\d/.test(compact);
}

export function detectBankKind(bankName: string): BankKind {
  const spaced = spacedName(foldName(bankName));
  const compact = compactName(spaced);
  if (compact.length === 0) {
    return 'other';
  }
  if (/альфа|alfa|alpha/.test(compact)) {
    return 'alfa';
  }
  if (/сбер|sber/.test(compact)) {
    return 'sber';
  }
  if (/втб|vtb/.test(compact)) {
    return 'vtb';
  }
  if (/отп|otp/.test(compact)) {
    return 'otp';
  }
  if (isTBank(spaced, compact)) {
    return 'tbank';
  }
  return 'other';
}

const KIND_EMOJI: Record<BankKind, string> = {
  sber: GREEN,
  vtb: BLUE,
  alfa: RED,
  otp: ORANGE,
  tbank: YELLOW,
  other: CARD,
};

export function getBankEmoji(bankName: string): string {
  return KIND_EMOJI[detectBankKind(bankName)];
}
