/**
 * Цветной маркер банка по названию материала.
 * Подстрока, регистр, дефис и пробелы не важны: «Втб2312» → 🔵.
 *
 * Неизвестные банки — ⚪ или 🟤, выбор стабилен для одного и того же названия.
 */
const GREEN = '🟢';
const YELLOW = '🟡';
const BLUE = '🔵';
const RED = '🔴';
const GRAY = '⚪';
const BROWN = '🟤';

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

function otherBankEmoji(name: string): typeof GRAY | typeof BROWN {
  let hash = 0;
  for (const ch of name) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) | 0;
  }
  return (hash & 1) === 0 ? GRAY : BROWN;
}

export function getBankEmoji(bankName: string): string {
  const spaced = spacedName(foldName(bankName));
  const compact = compactName(spaced);
  if (compact.length === 0) {
    return otherBankEmoji(bankName);
  }
  if (/альфа|alfa|alpha/.test(compact)) {
    return RED;
  }
  if (/сбер|sber/.test(compact)) {
    return GREEN;
  }
  if (/втб|vtb/.test(compact)) {
    return BLUE;
  }
  if (isTBank(spaced, compact)) {
    return YELLOW;
  }
  return otherBankEmoji(bankName);
}
