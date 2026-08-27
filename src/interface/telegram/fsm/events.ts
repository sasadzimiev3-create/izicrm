import type { CardId } from '../../../domain/cards/card.js';
import type { BusinessDate } from '../../../domain/finance/period.js';

/**
 * События FSM после разбора апдейта и guard-ей.
 * Не содержат grammy/Telegram.
 */
export type DialogEvent =
  | { t: 'Start' }
  | { t: 'Home' }
  | { t: 'Cancel' }
  | { t: 'Expired' }
  | { t: 'Settings' }
  | { t: 'Report' }
  | { t: 'ReportDone' }
  | { t: 'ReportFailed'; message: string }
  | { t: 'TopUpMenu' }
  | { t: 'CardAdd' }
  | { t: 'NameEntered'; name: string }
  | { t: 'NameDuplicate' }
  | { t: 'NameInvalid'; message: string }
  | { t: 'AmountEntered'; amount: string; name: string; previous?: string }
  | { t: 'AmountInvalid'; message: string }
  | { t: 'TopUpPick' }
  | { t: 'TopUpCard'; cardId: CardId; businessDate: BusinessDate }
  | { t: 'ExpenseMenu' }
  | { t: 'FreezePick' }
  | { t: 'FreezeCard'; cardId: CardId }
  | { t: 'SpendPick' }
  | { t: 'SpendCard'; cardId: CardId; businessDate: BusinessDate }
  | { t: 'UnfreezePick' }
  | { t: 'FrozenMenu'; cardId: CardId }
  | { t: 'Unfreeze'; cardId: CardId }
  | { t: 'UpdateAll'; queue: CardId[]; businessDate: BusinessDate }
  | { t: 'UpdateOne'; cardId: CardId; businessDate: BusinessDate }
  | { t: 'Skip'; name: string; previous: string }
  | { t: 'ArchivePick' }
  | { t: 'ArchiveList' }
  | { t: 'Archive'; cardId: CardId }
  | { t: 'ArchiveYes'; needsDisposition: boolean; remainder: string; name: string }
  | { t: 'Withdrawn' }
  | { t: 'Lost' }
  | { t: 'Transferred' }
  | { t: 'ArchiveTarget'; cardId: CardId }
  | { t: 'NotFound' }
  | { t: 'Stale' }
  | { t: 'NoWorkingCards' };
