import type { CardRow } from '../../../application/ports/card-repository.js';
import { formatMoney } from '../../../domain/money/format.js';
import type { Money } from '../../../domain/money/money.js';

import { COPY } from './copy.js';
import { formatCardTitle } from './dashboard.view.js';

export function renderCardPrompt(title: string, body: string): string {
  return `${title}\n${body}`;
}

export function renderArchivedList(cards: CardRow[]): string {
  if (cards.length === 0) {
    return `${COPY.archiveEmpty}\n${COPY.archiveReadonly}`;
  }
  const lines = [COPY.archiveMaterials, COPY.archiveReadonly, ''];
  for (const card of cards) {
    const when = card.archivedOn ?? '';
    lines.push(`${formatCardTitle(card.name)} ${'\u2014'} ${when}`);
  }
  return lines.join('\n');
}

export function renderFrozenCard(name: string, balance: Money): string {
  return `${formatCardTitle(name)} ${'\u2014'} ${formatMoney(balance)}\n${COPY.frozenLabel}`;
}

export function renderNoWorking(): string {
  return `${COPY.noWorking}`;
}
