/** Команда /start — вход на главный экран. */
export function isStartCommand(text: string): boolean {
  return /^\/start(?:@\w+)?(?:\s|$)/u.test(text.trim());
}
