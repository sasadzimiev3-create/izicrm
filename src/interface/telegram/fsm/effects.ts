import type { CardId } from '../../../domain/cards/card.js';
import type { BusinessDate } from '../../../domain/finance/period.js';

import type { DialogState } from './states.js';

/**
 * Намерения рантайма. Арифметики нет: сервис и view вызываются снаружи.
 */
export type Effect =
  | { t: 'ShowHome' }
  | { t: 'ShowSettings' }
  | { t: 'SendWebLink' }
  | { t: 'ShowTopUpMenu' }
  | { t: 'ShowExpenseMenu' }
  | { t: 'ShowArchived' }
  | { t: 'PromptName' }
  | { t: 'PromptBalance'; name: string }
  | { t: 'CreateCard'; name: string; amount: string }
  | { t: 'NameTaken' }
  | { t: 'InvalidInput'; message: string }
  | { t: 'ShowTopUpList' }
  | { t: 'PromptTopUp' }
  | { t: 'ApplyTopUp'; cardId: CardId; amount: string; businessDate: BusinessDate }
  | { t: 'ShowFreezeList' }
  | { t: 'ApplyFreeze'; cardId: CardId }
  | { t: 'ShowSpendList' }
  | { t: 'ShowUnfreezeList' }
  | { t: 'PromptSpend' }
  | { t: 'ApplySpend'; cardId: CardId; amount: string; businessDate: BusinessDate }
  | { t: 'ShowFrozenMenu'; cardId: CardId }
  | { t: 'ApplyUnfreeze'; cardId: CardId }
  | { t: 'PromptUpdate' }
  | { t: 'ApplyUpdate'; cardId: CardId; amount: string; businessDate: BusinessDate }
  | { t: 'ShowArchiveList' }
  | { t: 'PromptArchiveConfirm'; cardId: CardId }
  | { t: 'PromptDisposition'; name: string; remainder: string }
  | { t: 'ShowArchiveTargets' }
  | { t: 'ApplyArchive'; cardId: CardId; reason: 'WITHDRAWN' | 'LOST' | 'TRANSFERRED'; targetCardId?: CardId }
  | { t: 'BuildReport' }
  | { t: 'ReportUnavailable'; message: string }
  | { t: 'NotFound' }
  | { t: 'Stale' }
  | { t: 'Expired' }
  | { t: 'NoWorkingCards' }
  | { t: 'Ignore' };

export type ReduceResult = {
  next: DialogState;
  effects: Effect[];
};
