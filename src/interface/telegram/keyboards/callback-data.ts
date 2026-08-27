export const CALLBACK_PREFIX = 'v1';
export const CALLBACK_MAX_BYTES = 64;

export type CallbackAction =
  | 'home'
  | 'settings'
  | 'report'
  | 'topup'
  | 'card_add'
  | 'topup_pick'
  | 'topup_card'
  | 'expense'
  | 'freeze_pick'
  | 'freeze'
  | 'spend_pick'
  | 'spend_card'
  | 'frozen'
  | 'unfreeze_pick'
  | 'unfreeze'
  | 'upd_all'
  | 'upd_one'
  | 'skip'
  | 'arch_pick'
  | 'arch_list'
  | 'card_archive'
  | 'yes'
  | 'withdrawn'
  | 'lost'
  | 'transferred'
  | 'target'
  | 'cancel'
  | 'page';

const ACTIONS = new Set<string>([
  'home',
  'settings',
  'report',
  'topup',
  'card_add',
  'topup_pick',
  'topup_card',
  'expense',
  'freeze_pick',
  'freeze',
  'spend_pick',
  'spend_card',
  'frozen',
  'unfreeze_pick',
  'unfreeze',
  'upd_all',
  'upd_one',
  'skip',
  'arch_pick',
  'arch_list',
  'card_archive',
  'yes',
  'withdrawn',
  'lost',
  'transferred',
  'target',
  'cancel',
  'page',
]);

export type ParsedCallback =
  | { ok: true; version: 'v1'; action: CallbackAction; id: string; rev: number }
  | { ok: false; reason: 'unknown_version' | 'malformed' };

/**
 * Формат `v1:<action>:<id>:<rev>`, лимит Telegram — 64 байта.
 *
 * @see docs/telegram-flows.md §5
 */
export function encodeCallback(action: CallbackAction, id: string | number | null, rev: number): string {
  const idPart = id === null || id === '' ? '-' : String(id);
  const data = `${CALLBACK_PREFIX}:${action}:${idPart}:${String(rev)}`;
  if (Buffer.byteLength(data, 'utf8') > CALLBACK_MAX_BYTES) {
    throw new Error('callback_data exceeds 64 bytes');
  }
  return data;
}

export function parseCallbackData(raw: string): ParsedCallback {
  const parts = raw.split(':');
  if (parts.length !== 4) {
    return { ok: false, reason: 'malformed' };
  }
  const [version, action, id, revRaw] = parts;
  if (version !== CALLBACK_PREFIX) {
    return { ok: false, reason: 'unknown_version' };
  }
  if (action === undefined || !ACTIONS.has(action) || revRaw === undefined || !/^\d+$/.test(revRaw)) {
    return { ok: false, reason: 'malformed' };
  }
  return {
    ok: true,
    version: 'v1',
    action: action as CallbackAction,
    id: id === '-' || id === undefined ? '' : id,
    rev: Number(revRaw),
  };
}
