import type { UserRecord } from '../../../application/ports/user-repository.js';
import type { TelegramDeps } from '../deps.js';
import type { IncomingUpdate, TelegramSender } from '../protocol.js';
import { COPY } from '../views/copy.js';
import { renderActivityReport } from '../views/admin.view.js';

export function isAdminCommand(text: string): boolean {
  return /^\/admin(?:@\w+)?(?:\s|$)/u.test(text.trim());
}

export function isAdminTelegramId(telegramId: string, allowlist: readonly string[]): boolean {
  return allowlist.includes(telegramId);
}

export async function tryHandleAdmin(
  deps: TelegramDeps,
  user: UserRecord,
  update: IncomingUpdate,
  sender: TelegramSender,
): Promise<boolean> {
  if (update.kind !== 'message' || !isAdminCommand(update.text)) {
    return false;
  }
  if (!isAdminTelegramId(user.telegramId, deps.adminTelegramIds)) {
    return false;
  }
  try {
    const snapshot = await deps.services.activity.snapshot(
      user.id,
      deps.clock.now(),
      deps.timeZone,
    );
    await sender.sendMessage(renderActivityReport(snapshot));
  } catch {
    await sender.sendMessage(COPY.genericError);
  }
  return true;
}
