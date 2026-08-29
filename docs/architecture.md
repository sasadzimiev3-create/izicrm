# izicrm — Архитектура

---

## 1. Технологический стек

Версии проверены в реестре npm на 20.08.2026.

| Слой | Выбор | Версия | Обоснование |
|---|---|---|---|
| Runtime | Node.js LTS «Krypton» | 24.x | Активный LTS на дату решения. `@office-kit/xlsx` требует ≥ 22 |
| Язык | TypeScript, `strict` | 5.x | §15 требований прямо запрещает «обычный JS number» ⟹ типизированный JS-стек |
| Telegram | grammY | 1.45.x | Лучшая типизация среди TG-библиотек, активная разработка, middleware-модель. FSM — собственная (ADR-004) |
| БД | PostgreSQL | 17 | Требование §14. Нужен `security_invoker` для VIEW (≥ 15) |
| Драйвер | `pg` | 8.23.x | `NUMERIC` возвращает строкой — без потери точности |
| Доступ к данным | Kysely | 0.29.x | Типизированный SQL без ORM-магии; `DISTINCT ON`, CTE, `SET LOCAL` для RLS (ADR-002) |
| Миграции | node-pg-migrate | 9.x | Чистый SQL — нужен для RLS-политик, партиальных индексов, VIEW |
| Decimal | decimal.js | 10.6.x | Настраиваемая точность и явный режим округления |
| Валидация | Zod | 4.x | Разбор ввода пользователя, `JSONB`-payload FSM, переменных окружения |
| Excel | `@office-kit/xlsx` | 0.9.0, точная версия | Единственная живая MIT-библиотека с нативными графиками (ADR-006) |
| Тесты | Vitest | 4.x | Нативный TS, быстрый watch |
| Property-тесты | fast-check | 4.x | Проверка теорем T-1…T-11 |
| Интеграционные тесты | Testcontainers | — | Реальный PostgreSQL: RLS, индексы, LOCF-SQL |
| Логи | pino | — | Структурные логи, редакция чувствительных полей |
| Прочее | ESLint + Prettier, Docker Compose, GitHub Actions | — | |

**Отвергнуто:**
- **Prisma** — слабая поддержка `DISTINCT ON`, оконных функций и пер-транзакционного RLS-контекста; всё равно пришлось бы уходить в raw SQL, теряя типизацию.
- **Drizzle** — хороший кандидат, но обращение с `numeric` требует ручной настройки режима, а RLS-поддержка моложе. Kysely ближе к SQL, что важно для LOCF-запросов.
- **Хранение денег в копейках (`BIGINT`)** — детерминированнее, но §14 требований прямо предписывает `decimal/numeric`.
- **Redis для FSM** — лишняя инфраструктура; состояние диалогов живёт в PostgreSQL (ADR-005).

**Требования к окружению.** Node 24+, PostgreSQL 17, Docker. На машине разработчика сейчас
не установлено ни одного из них — нужно поставить до этапа реализации.

---

## 2. Слои

```
┌─────────────────────────────────────────────────────────┐
│  interface/telegram        handlers, keyboards, FSM,    │  без бизнес-логики
│                            views (чистый рендер текста) │
├─────────────────────────────────────────────────────────┤
│  application               use cases, транзакции,       │  оркестрация
│                            ports (интерфейсы репо)      │
├─────────────────────────────────────────────────────────┤
│  domain                    money, finance, cards        │  чистые функции, без I/O
├─────────────────────────────────────────────────────────┤
│  infrastructure            repositories, db, excel, tg  │  реализация портов
├─────────────────────────────────────────────────────────┤
│  PostgreSQL                                             │
└─────────────────────────────────────────────────────────┘
```

Правила зависимостей (проверяются ESLint-правилом `import/no-restricted-paths`):

| Слой | Может импортировать | Запрещено |
|---|---|---|
| `domain` | только `domain` | всё остальное, включая `pg`, `grammy`, `Date.now()` |
| `application` | `domain`, `application/ports` | `infrastructure`, `grammy` |
| `infrastructure` | `domain`, `application/ports` | `interface` |
| `interface` | `application`, `domain` (типы и форматирование) | `infrastructure`, прямой SQL |

`domain` не знает про базу, Telegram и время. Текущая дата **передаётся параметром** —
это делает тесты детерминированными (T-8).

---

## 3. Структура каталогов

```
src/
  domain/
    money/           money.ts  percent.ts  format.ts  parse.ts
    finance/         balance.ts  capital.ts  card-scope.ts  flows.ts
                     pnl.ts  dietz.ts  card-change.ts  period.ts
    cards/           card-name.ts  card.ts  bank-emoji.ts
    errors.ts
  application/
    ports/           card-repository.ts  balance-repository.ts
                     dialog-state-repository.ts  unit-of-work.ts  xlsx-writer.ts
    services/        dashboard.service.ts  card.service.ts
                     balance-update.service.ts  topup.service.ts
                     freeze.service.ts  spend.service.ts  archive.service.ts  report.service.ts
    dto/
  infrastructure/
    db/              pool.ts  unit-of-work.ts  user-context.ts  types.ts
    repositories/    card.repository.ts  balance.repository.ts  dialog-state.repository.ts
                     report-query.repository.ts
    excel/           report-builder.ts  adapters/
    telegram/        bot.ts  transport.ts
  interface/telegram/
    fsm/             states.ts  transitions.ts  machine.ts  guards.ts
    handlers/        start.ts  dashboard.ts  card-create.ts
                     card-archive.ts  card-topup.ts  card-freeze.ts  card-spend.ts
                     balance-update.ts  report.ts
    keyboards/       callback-data.ts  keyboards.ts
    views/           dashboard.view.ts  cards.view.ts
  config/            env.ts  clock.ts
  main.ts
migrations/          NNN_*.sql
tests/               unit/  property/  integration/  security/  e2e/
docs/
```

---

## 4. Ключевые архитектурные решения (ADR)

### ADR-001. Единственный источник истины для P&L

Все расчёты прибыли проходят через `domain/finance/pnl.ts:periodPnl`. Дневной, месячный и
общий P&L — параметризации. Дублирование формулы в SQL, в сервисах или в генераторе Excel
запрещено (NFR-8).

**Следствие: арифметика над деньгами в SQL запрещена, включая `SUM()`.** SQL только выбирает
строки (LOCF-снимки, упорядоченные записи), суммирование выполняет `Decimal` в domain-слое.
Иначе появился бы второй, невидимый для тестов источник истины с другими правилами округления.

Оценка объёма: 20 карт × 10 лет ≈ 73 000 строк на полный отчёт — приемлемо для потоковой обработки.

### ADR-002. Kysely вместо ORM

Нужны `DISTINCT ON` для LOCF, оконные функции, `generate_series` для дневных серий графиков,
`SET LOCAL` для RLS-контекста и полный контроль над типами. Kysely даёт типизацию без сокрытия SQL.

### ADR-003. Внешние потоки производные, а не хранимые

См. `docs/financial-model.md` §4. Депозиты живут в поле `capital_in` записи баланса
и вытесняются вместе с ней (C-26). Выводы по-прежнему выводятся из архивирования
`WITHDRAWN`. Отдельная таблица потоков запрещена: она рассинхронизируется с исправленным
балансом и даёт фантомный убыток.

### ADR-004. Собственная FSM вместо grammY conversations

§17 требований предписывает явную state machine. `conversations` grammY хранит состояние как
воспроизводимый лог выполнения — это неявная модель, плохо тестируемая и хрупкая при деплое.
Собственная FSM: размеченное объединение состояний + таблица переходов + чистая функция
`reduce(state, event) → { state, effects }`. Тестируется без Telegram.

### ADR-005. Состояние диалогов в PostgreSQL

Таблица `dialog_states`, одна строка на пользователя, с `expires_at`. Причины: перезапуск бота
не теряет незавершённые диалоги; не требуется Redis; состояние попадает под RLS.
Нагрузка персонального бота этого более чем достаточно.

**Деньги в `JSONB` хранятся строками.** JSON-числа — двоичные float, это нарушило бы NFR-4.

### ADR-006. Генерация Excel — `@office-kit/xlsx` **[РЕШЕНО 20.08.2026]**

§12 требует графики. Проверка экосистемы на 20.08.2026:

| Вариант | Нативные графики | Состояние | Риск |
|---|---|---|---|
| **A. `@office-kit/xlsx`** | Да (16 классических + 8 ChartEx) | MIT, обновлён 12.07.2026, требует Node ≥ 22 | Версия `0.9.0` — до 1.0, малая экосистема |
| **B. ExcelJS + PNG-графики** | Нет; графики вставляются картинками (ECharts SSR → SVG → `@resvg/resvg-js`) | ExcelJS `4.4.0`, последний релиз 20.12.2024, мейнтейнеры называют проект неактивным | Графики не интерактивны; библиотека без обновлений безопасности |
| C. Шаблон .xlsx с готовыми графиками | Да | — | ExcelJS **удаляет** графики при чтении файла ⟹ несовместимо с B |
| D. Ручная сборка OOXML | Да | — | Слишком высокая цена поддержки |

**Принято: вариант A — `@office-kit/xlsx`.** Графики нативные и интерактивные, лицензия MIT,
проект активно развивается. Версия фиксируется точно, без `^`: библиотека до 1.0, минорные
релизы могут ломать API.

Вариант B остаётся документированным резервом: если адаптер A окажется несостоятельным,
пишется второй адаптер того же порта без изменений в бизнес-логике и тестах расчётов.

Снижение риска — порт `application/ports/xlsx-writer.ts`:

```ts
export interface XlsxWriter {
  write(report: ReportDataset): Promise<Buffer>;
}
```

`ReportDataset` — чистая структура данных, полностью покрытая unit-тестами и не зависящая от
библиотеки. Смена адаптера не затрагивает ни бизнес-логику, ни тесты расчётов.
Дополнительно: тест распаковывает готовый `.xlsx` и проверяет наличие частей `xl/charts/chart*.xml`,
листов и числовых форматов.

### ADR-007. Двойная изоляция данных

1. **Типы:** каждый метод репозитория принимает `UserId` первым аргументом. Метода `getCard(cardId)` не существует физически.
2. **RLS:** приложение работает под ролью без `BYPASSRLS`; каждая транзакция выставляет `app.current_user_id`; политики отсекают чужие строки.

RLS — второй барьер, а не замена скоупингу (NFR-10). См. `docs/database.md` §5.

### ADR-008. Транзакции через Unit of Work с пользовательским контекстом

Единственный способ обратиться к БД:

```ts
await uow.withUser(userId, async (tx) => { /* репозитории получают tx */ });
```

`withUser` открывает транзакцию, выполняет `SET LOCAL app.current_user_id`, передаёт `tx`
репозиториям. Прямой доступ к пулу из репозиториев запрещён ESLint-правилом. Без контекста
RLS-политики не пропускают ни одной строки (fail-closed).

### ADR-009. Идемпотентность обработки апдейтов

Таблица `processed_updates(update_id PRIMARY KEY)`. Повторная доставка апдейта Telegram или
двойное нажатие кнопки не создают вторую запись баланса. Плюс защита от устаревших кнопок
через ревизию состояния в `callback_data` (`docs/telegram-flows.md` §5).

### ADR-010. Чистые view-функции для Telegram-текстов

Рендер экранов — чистые функции `(viewModel) => string`, покрытые snapshot-тестами.
Handlers только вызывают сервис и передают результат в view. Никакой арифметики в шаблонах.

### ADR-011. Роль обслуживания для очистки служебных таблиц

`processed_updates` старше 7 суток и просроченные `dialog_states` нужно удалять, иначе таблицы
растут без верхней границы. Роль `izicrm_app` права `DELETE` не имеет принципиально: это второй
барьер против случайного или ошибочного удаления финансовых строк (A-4). Значит, чистить
должно не приложение.

Принято: отдельная роль `izicrm_maintenance`. Ей выдаётся `DELETE` (и `SELECT` для проверки)
**только** на `processed_updates` и `dialog_states`. Финансовые таблицы — ни `SELECT`, ни
`DELETE`, ни `INSERT`. `BYPASSRLS` и `SUPERUSER` не выдаются.

RLS на этих двух таблицах остаётся включённым. Политика изоляции (`user_id = app.current_user_id`)
без контекста не пропускает ни одной строки, поэтому добавлены отдельные политики сборки мусора
`FOR DELETE TO izicrm_maintenance`:

- `processed_updates`: `processed_at < now() - interval '7 days'`
- `dialog_states`: `expires_at < now()`

Политики пермиссивные и объединяются через OR: приложение по-прежнему видит только свои строки,
роль обслуживания удаляет только просроченные, чужие живые диалоги ей недоступны.

Почему не `izicrm_migrator` по cron: эта роль владеет схемой, и регулярная работа под ней
расширяет поверхность риска сильнее, чем узкая роль без доступа к деньгам. Почему не
`DELETE` у `izicrm_app` на двух таблицах: формулировка «у приложения нет DELETE» тогда
перестаёт быть проверяемой одним запросом к системному каталогу, а тест DB-11 ровно это и делает.

Регламент запуска — этап 8: systemd-timer или cron вызывает `DELETE` под `izicrm_maintenance`.
Приложение эти запросы не выполняет.

---

## 5. Сквозные сценарии

### 5.1. Главный экран

```
/start или [🏠]
  → handler: разбор апдейта, извлечение userId
  → DashboardService.getDashboard(userId, today)
      uow.withUser(userId):
        cardRepo.listInScope(userId, today)
        cardRepo.listFrozen(userId, today)
        balanceRepo.locfSnapshot(userId, today)          — SQL: DISTINCT ON
        balanceRepo.previousUpdateDate(userId, today)
        balanceRepo.locfSnapshot(userId, prevDate)
        cardRepo.flowsInRange(userId, monthStart, today)  — VIEW v_capital_flows
      → domain: capitalAsOf, workingCapitalAsOf, frozenCapitalAsOf,
                periodPnl (месяц), dailyPnl, cardBalanceChange
      → DashboardViewModel
  → views/dashboard.view.ts → текст + клавиатура
```

Все запросы к БД — в одной транзакции, все расчёты — после чтения, в `Decimal`.

### 5.2. Обновление всех балансов

```
[🔄 Обновить баланс] → [Все в обороте]
  → FSM: Idle → BalanceUpdateAwaitingAmount { queue, index: 0, businessDate: today }
  → queue = незамороженные карты в scope; замороженные не входят (C-27)
  → на каждый ввод:
      парсинг суммы (Zod + domain/money/parse)   — ошибка не продвигает состояние
      guard: карта всё ещё принадлежит пользователю и активна
      uow.withUser: upsert записи (вытеснение предыдущей за ту же дату)
      index++ → следующая карта либо итог
  → итог: DashboardService.getDashboard → FSM: Idle
```

`businessDate` фиксируется при старте (C-11). Прерывание на середине допустимо: не обновлённые
карты остаются на LOCF-балансах, что математически корректно (T-7).

### 5.3. Excel-отчёт

```
[📊 Excel-отчёт]
  → rate limit: не чаще 1 отчёта в минуту на пользователя
  → ReportService.build(userId, today)
      uow.withUser: полная выгрузка карт, записей, потоков (курсором)
      → domain: серии капитала, дневные/месячные P&L, KPI
      → ReportDataset
  → XlsxWriter.write(dataset) → Buffer
  → sendDocument, затем удаление временного файла
```

---

## 6. Обработка ошибок

| Класс | Поведение |
|---|---|
| `ValidationError` (ввод пользователя) | Понятное сообщение, состояние не меняется, повторный запрос |
| `ConflictError` (дубль имени, `23505`) | «Материал с таким названием уже есть» |
| `NotFoundError` / чужой `card_id` | Нейтральное «Материал не найден» — без раскрытия существования; запись в лог безопасности |
| `StaleCallbackError` | «Кнопка устарела», перерисовка экрана |
| Инфраструктурные | Лог + «Что-то пошло не так», повтор через backoff; финансовые данные не теряются |

Правило: **никакой финансовой операции без транзакции**. Ошибка внутри `withUser` откатывает всё.

---

## 7. Наблюдаемость и эксплуатация

- Логи `pino`: `user_id` пишется, суммы — нет (приватность); ID корреляции на апдейт.
- Метрики: время расчёта дашборда, время генерации отчёта, число апдейтов, ошибки по классам.
- Health-check: доступность БД, применённость миграций.
- Деплой: Docker, long polling по умолчанию, webhook опционально; graceful shutdown с дожатием текущих транзакций.
- Бэкапы: `pg_dump` по расписанию + PITR. Финансовые данные неудаляемы (A-4), поэтому история восстановима.
- Ограничения Telegram: 1 сообщение в секунду на чат — очередь отправки; лимит 4096 символов — пагинация списка карт.
