/** Тексты интерфейса. Банковский термин из C-18 здесь запрещён (FR-6.7). */

export const COPY = {
  notFound: 'Материал не найден',
  stale: 'Кнопка устарела',
  expired: 'Диалог отменён из-за неактивности',
  genericError: 'Что-то пошло не так',
  nameTaken: 'Материал с таким названием уже есть',
  noWorking: 'Нет материалов в работе',
  emptyOnboarding: 'Пока нет ни одного материала',
  allArchived: 'Нет материалов в работе — все в архиве.',
  cancel: 'Отмена',
  back: 'Назад',
  skip: 'Пропустить',
  newCard: 'новый',
  promptName: 'Введите название материала:',
  promptBalance: (name: string) => `${name}\nВведите текущий баланс:`,
  createHint:
    'Эта сумма — точка отсчёта, прибылью не считается.\nПрибыль появится, когда обновите баланс.',
  topUpMenu: 'Пополнить',
  addMaterial: 'Добавить материал',
  topUpExisting: 'Пополнить материал',
  promptTopUp: (name: string, current: string) =>
    `${name}\nСейчас: ${current}\n\nВведите новый баланс:`,
  topUpDone: (delta: string, name: string, balance: string) =>
    `Пополнено на ${delta}. Прибыль не изменилась.\n${name} · ${balance}`,
  expenseMenu: 'Расход',
  freezePick: 'Заблокировать материал',
  spendPick: 'Потратил / вывел',
  freezeWhich: 'Какой материал заблокировать?',
  unfreezeWhich: 'Какой материал вернуть в оборот?',
  noFrozen: 'Нет замороженных материалов',
  freezeDone: (name: string) =>
    `${name} заморожен. Во «Всего» он остался, прибыль не изменилась.`,
  unfreezeDone: (name: string) =>
    `${name} снова в работе. Прибыль не изменилась.`,
  promptSpend: (name: string, current: string) =>
    `${name}\nСейчас: ${current}\n\nВведите новый баланс после траты:`,
  spendDone: (delta: string, name: string, balance: string) =>
    `Выведено ${delta}. Прибыль не изменилась.\n${name} · ${balance}`,
  frozenLabel: 'Заморожено',
  returnToWork: 'Вернуть в оборот',
  updateBalance: 'Обновить баланс',
  promptUpdate: (name: string, index: number, total: number, previous: string) =>
    `${name}  (${index} из ${total})\nПредыдущий баланс: ${previous}\n\nВведите текущий баланс:`,
  updateSummaryTitle: (count: number, date: string) =>
    `Обновлено ${String(count)} ${pluralMaterials(count)} · ${date}`,
  skippedLine: (count: number) => `Пропущено: ${String(count)}`,
  settingsTitle: 'Настройки',
  report: 'Отчёт в Excel',
  deleteMaterial: 'Удалить материал',
  archiveMaterials: 'Архив материалов',
  archiveEmpty: 'Архив пуст.',
  archiveReadonly: 'Только просмотр — вернуть из архива нельзя.',
  pickMaterial: 'Выберите материал:',
  archiveConfirm: (name: string, balance: string) =>
    `Удалить «${name}»?\nТекущий баланс: ${balance}\n\nИстория сохранится и останется в отчётах.`,
  archiveConfirmZero: (name: string) =>
    `Удалить «${name}»?\nОстаток нулевой. История сохранится.`,
  dispositionPrompt: (name: string, remainder: string) =>
    `Удалить «${name}»?\nТекущий баланс: ${remainder}\n\nИстория сохранится и останется в отчётах.\nЧто стало с этими деньгами?`,
  transferred: 'Перевёл на другой материал — прибыль не изменится',
  withdrawn: 'Вывел: снял или потратил — прибыль не изменится',
  lost: (remainder: string) => `Потерял — это убыток ${remainder}`,
  pickTarget: 'На какой материал перевести остаток?',
  archivedDone: 'Материал удалён. История сохранена.',
  reportWait: 'Готовлю отчёт…',
  reportRateLimit: 'Отчёт можно запросить не чаще одного раза в минуту.',
  reportUnavailable: 'Отчёт пока недоступен.',
  workingHeader: 'В работе:',
  frozenHeader: 'Заморожено:',
  totalHeader: 'Всего:',
  todayPrefix: 'СЕГОДНЯ',
  lastUpdatePrefix: 'ПОСЛЕДНЕЕ ОБНОВЛЕНИЕ',
  yes: 'Да',
} as const;

export function pluralMaterials(count: number): string {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) {
    return 'материалов';
  }
  if (n1 === 1) {
    return 'материал';
  }
  if (n1 >= 2 && n1 <= 4) {
    return 'материала';
  }
  return 'материалов';
}

export function pluralDays(count: number): string {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) {
    return 'дней';
  }
  if (n1 === 1) {
    return 'день';
  }
  if (n1 >= 2 && n1 <= 4) {
    return 'дня';
  }
  return 'дней';
}
