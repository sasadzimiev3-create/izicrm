# izicrm — База данных

PostgreSQL 17. Одна физическая база, логическая изоляция по `user_id` (NFR-1).
Все изменения схемы — только через миграции (NFR-3).

---

## 1. Принципы

| Принцип | Реализация |
|---|---|
| Деньги точны | `NUMERIC(20,2)`; `float`/`double` не используются нигде |
| Финансовые данные неудаляемы | Append-only + логическое вытеснение; `ON DELETE RESTRICT` на финансовых FK |
| Изоляция пользователей | `user_id` в каждой пользовательской таблице + RLS + композитные FK |
| Бизнес-дата ≠ момент времени | `DATE` для бизнес-дат, `TIMESTAMPTZ` для моментов |
| Один источник истины | Потоки капитала — VIEW, а не таблица (ADR-003) |
| Никакой арифметики над деньгами в SQL | SQL выбирает строки, `Decimal` считает (NFR-11) |

---

## 2. Роли

```sql
-- владелец схемы, выполняет миграции; RLS к нему не применяется в обычном режиме
CREATE ROLE izicrm_migrator LOGIN PASSWORD :'migrator_password';

-- рабочая роль приложения: только DML, БЕЗ BYPASSRLS, НЕ суперпользователь
CREATE ROLE izicrm_app LOGIN PASSWORD :'app_password';

-- очистка служебных таблиц; финансовых данных не видит (ADR-011)
CREATE ROLE izicrm_maintenance LOGIN PASSWORD :'maintenance_password';

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO izicrm_app;
GRANT USAGE ON SCHEMA public TO izicrm_maintenance;
```

Приложение подключается **только** как `izicrm_app`. Проверяется тестом: попытка запуска под
ролью с `BYPASSRLS` или `SUPERUSER` завершается ошибкой на старте. Роль `izicrm_maintenance`
в рантайме бота не используется: её вызывает только регламент очистки (этап 8).

---

## 3. Схема

### 3.1. Типы

```sql
CREATE TYPE initial_balance_kind AS ENUM ('BALANCE', 'PROFIT');
CREATE TYPE archive_reason       AS ENUM ('WITHDRAWN', 'TRANSFERRED', 'LOST');
CREATE TYPE balance_entry_source AS ENUM (
  'CARD_CREATED',          -- начальный баланс при создании карты
  'DAILY_UPDATE',          -- обычное ежедневное обновление
  'CORRECTION',            -- исправление за уже закрытую дату
  'ARCHIVE_TRANSFER_IN',   -- приход остатка с архивируемой карты (C-3)
  'ARCHIVE_ZERO_OUT'       -- обнуление архивируемой карты при переводе
);
CREATE TYPE capital_flow_kind    AS ENUM ('DEPOSIT', 'WITHDRAWAL');
```

### 3.2. `users`

```sql
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id   BIGINT      NOT NULL UNIQUE,
  tz            TEXT        NOT NULL DEFAULT 'Europe/Moscow',
  language_code TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked_at    TIMESTAMPTZ
);
```

`telegram_id` — `BIGINT`: идентификаторы Telegram выходят за пределы `int4`.
`tz` обслуживает вычисление бизнес-даты (C-8). Валидность таймзоны проверяется на уровне
приложения по `pg_timezone_names`, а не `CHECK`-ограничением: `CHECK` не может опираться на
неизменяемые функции вроде `now()` — такое ограничение ломается при `pg_restore`.

### 3.3. `cards`

```sql
CREATE TABLE cards (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        BIGINT      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  name           TEXT        NOT NULL,
  name_norm      TEXT        NOT NULL
                 GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) STORED,
  icon           TEXT,
  initial_kind   initial_balance_kind NOT NULL,
  created_on     DATE        NOT NULL,
  archived_on    DATE,
  archive_reason archive_reason,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at    TIMESTAMPTZ,

  CONSTRAINT cards_name_not_blank    CHECK (btrim(name) <> ''),
  CONSTRAINT cards_name_len          CHECK (char_length(name) BETWEEN 1 AND 64),
  -- C-20: декоративный стикер, ровно один символ; длина ограничена, чтобы произвольный
  -- текст не попал в вывод как часть названия
  CONSTRAINT cards_icon_single_char  CHECK (icon IS NULL OR char_length(icon) BETWEEN 1 AND 8),
  CONSTRAINT cards_archive_coherent  CHECK (
    (archived_on IS NULL AND archived_at IS NULL AND archive_reason IS NULL) OR
    (archived_on IS NOT NULL AND archived_at IS NOT NULL AND archive_reason IS NOT NULL)
  ),
  CONSTRAINT cards_archive_after_create CHECK (archived_on IS NULL OR archived_on >= created_on),

  -- цель для композитного FK из balance_entries: делает межпользовательские строки невозможными
  CONSTRAINT cards_user_id_unique UNIQUE (user_id, id)
);

-- C-6: уникальность названия только среди активных карт
CREATE UNIQUE INDEX cards_active_name_uniq
  ON cards (user_id, name_norm) WHERE archived_on IS NULL;

CREATE INDEX cards_user_active_idx ON cards (user_id) WHERE archived_on IS NULL;
CREATE INDEX cards_user_scope_idx  ON cards (user_id, created_on, archived_on);
```

`name_norm` — сгенерированный столбец: `trim`, сжатие внутренних пробелов, нижний регистр.
Именно он участвует в уникальности, поэтому `«Сбер1»`, `«сбер1»` и `«Сбер1 »` — одна карта (C-6).
`initial_kind` неизменяем после создания (проверяется в сервисе и триггером ниже).

`icon` — декоративный эмодзи-маркер материала (C-20). Расчётного смысла не имеет и в формулах
не участвует; `NULL` означает «без маркера». Значение проверяется по белому списку эмодзи в слое
`application` — ограничение в БД задаёт только границу длины, потому что валидация графем
в `CHECK` нечитаема и ломается при обновлении Unicode.

### 3.4. `balance_entries`

Ядро истории. Append-only (A-4).

```sql
CREATE TABLE balance_entries (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        BIGINT       NOT NULL,
  card_id        BIGINT       NOT NULL,
  effective_date DATE         NOT NULL,
  amount         NUMERIC(20,2) NOT NULL,
  source         balance_entry_source NOT NULL,
  recorded_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  superseded_at  TIMESTAMPTZ,
  superseded_by  BIGINT       REFERENCES balance_entries (id) ON DELETE RESTRICT,

  CONSTRAINT be_card_fk FOREIGN KEY (user_id, card_id)
    REFERENCES cards (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT be_supersede_coherent CHECK ((superseded_at IS NULL) = (superseded_by IS NULL)),
  -- литералы записаны как numeric, не как 1e15: экспоненциальная форма даёт float8-константу
  CONSTRAINT be_amount_bounded CHECK (amount BETWEEN -1000000000000000.00 AND 1000000000000000.00)
);

-- FR-3.5: не более одной актуальной записи на (карта, бизнес-дата)
CREATE UNIQUE INDEX be_current_per_card_day_uniq
  ON balance_entries (card_id, effective_date) WHERE superseded_at IS NULL;

-- LOCF: DISTINCT ON (card_id) ... ORDER BY card_id, effective_date DESC
CREATE INDEX be_locf_idx
  ON balance_entries (user_id, card_id, effective_date DESC) WHERE superseded_at IS NULL;

-- поиск предыдущей даты обновления и выгрузка истории
CREATE INDEX be_user_date_idx
  ON balance_entries (user_id, effective_date DESC) WHERE superseded_at IS NULL;
```

**Композитный FK `(user_id, card_id) → cards (user_id, id)`** — структурная гарантия: запись
баланса физически не может ссылаться на карту другого пользователя. Это защита уровня схемы,
не зависящая ни от кода, ни от RLS.

**Про `NUMERIC(20,2)` (C-12).** PostgreSQL при вставке `10000.005` молча округлит до `10000.01`.
Это неявное округление, запрещённое NFR-4, поэтому валидация на входе отклоняет более двух
знаков после запятой. БД — второй барьер, не первый.

Триггер, запрещающий модификацию исторических данных:

```sql
CREATE OR REPLACE FUNCTION be_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.amount        IS DISTINCT FROM NEW.amount
  OR OLD.effective_date IS DISTINCT FROM NEW.effective_date
  OR OLD.card_id       IS DISTINCT FROM NEW.card_id
  OR OLD.user_id       IS DISTINCT FROM NEW.user_id
  OR OLD.source        IS DISTINCT FROM NEW.source THEN
    RAISE EXCEPTION 'balance_entries is append-only; create a superseding entry instead';
  END IF;
  IF OLD.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'entry % is already superseded', OLD.id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER be_immutable_trg BEFORE UPDATE ON balance_entries
  FOR EACH ROW EXECUTE FUNCTION be_immutable();

CREATE RULE be_no_delete AS ON DELETE TO balance_entries DO INSTEAD NOTHING;
```

Разрешено менять только `superseded_at`/`superseded_by`, и только один раз.

### 3.5. `dialog_states`

```sql
CREATE TABLE dialog_states (
  user_id       BIGINT      PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  state         TEXT        NOT NULL,
  payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  business_date DATE,
  state_rev     INTEGER     NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX dialog_states_expiry_idx ON dialog_states (expires_at);
```

`state` — тег размеченного объединения, `payload` валидируется Zod при чтении.
**Деньги в `payload` — строки, не JSON-числа** (JSON-числа двоичные, это нарушило бы NFR-4).
`business_date` фиксируется на старте диалога (C-11). `state_rev` защищает от устаревших
кнопок (`docs/telegram-flows.md` §5). `ON DELETE CASCADE` допустим: это не финансовые данные.
Просроченные строки удаляет роль `izicrm_maintenance` (ADR-011), не приложение: истёкший
диалог и так читается как `Idle`.

### 3.6. `processed_updates`

```sql
CREATE TABLE processed_updates (
  update_id    BIGINT      PRIMARY KEY,
  user_id      BIGINT      REFERENCES users (id) ON DELETE CASCADE,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX processed_updates_gc_idx ON processed_updates (processed_at);
```

Идемпотентность (ADR-009). Записи старше 7 суток удаляет `izicrm_maintenance` по расписанию
(ADR-011), не `izicrm_app`.

### 3.7. `audit_log`

```sql
CREATE TABLE audit_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  action     TEXT        NOT NULL,
  entity     TEXT        NOT NULL,
  entity_id  BIGINT,
  payload    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_user_idx ON audit_log (user_id, created_at DESC);
```

Фиксирует создание, переименование и архивирование карт, исправления балансов, генерацию
отчётов. Позволяет восстановить историю переименований (C-9).

---

## 4. Представления

Все VIEW создаются с `security_invoker = true` (PostgreSQL ≥ 15), иначе RLS базовых таблиц
не применялся бы к вызывающему — это была бы дыра в изоляции.

### 4.1. Актуальные записи

```sql
CREATE VIEW v_current_balance_entries WITH (security_invoker = true) AS
SELECT id, user_id, card_id, effective_date, amount, source, recorded_at
FROM balance_entries
WHERE superseded_at IS NULL;
```

### 4.2. Потоки капитала — производные (ADR-003)

```sql
CREATE VIEW v_capital_flows WITH (security_invoker = true) AS
-- депозит: начальный баланс карты типа BALANCE
SELECT c.user_id,
       c.id                       AS card_id,
       c.created_on               AS flow_date,
       'DEPOSIT'::capital_flow_kind AS kind,
       e.amount                   AS amount
FROM cards c
JOIN v_current_balance_entries e
  ON e.card_id = c.id AND e.effective_date = c.created_on
WHERE c.initial_kind = 'BALANCE'
  AND e.amount <> 0

UNION ALL

-- вывод: остаток карты, архивированной с причиной WITHDRAWN (LOCF на дату архивирования)
SELECT c.user_id,
       c.id,
       c.archived_on,
       'WITHDRAWAL'::capital_flow_kind,
       last_entry.amount
FROM cards c
CROSS JOIN LATERAL (
  SELECT e.amount
  FROM v_current_balance_entries e
  WHERE e.card_id = c.id AND e.effective_date <= c.archived_on
  ORDER BY e.effective_date DESC
  LIMIT 1
) AS last_entry
WHERE c.archived_on IS NOT NULL
  AND c.archive_reason = 'WITHDRAWN'
  AND last_entry.amount <> 0;
```

Депозит соединяется напрямую: запись на `created_on` существует всегда, поскольку создание
карты её пишет, а исправления вытесняют предыдущую, сохраняя ровно одну актуальную.
Именно поэтому исправление опечатки автоматически исправляет депозит (см. `financial-model.md` §4).

Во вью попадает только `WITHDRAWN`. Две другие причины потока не дают, но по разным основаниям:
`TRANSFERRED` — потому что остаток уже зачислен карте-получателю и капитал не изменился,
`LOST` — потому что падение капитала и есть убыток (T-9). Добавить `LOST` в это условие означало бы
молча обнулить все убытки от потерянных карт, поэтому `archive_reason = 'WITHDRAWN'` записано
явным равенством, а не как `<> 'TRANSFERRED'`: при появлении новой причины архивирования
условие не подхватит её по умолчанию.

Нулевой остаток при `WITHDRAWN` (удаление пустой карты, вопрос о судьбе не задаётся) из вью
исключён: `NetFlow` от нуля не меняется, а строка «вывод 0 ₽» в отчёте выглядит как мусор.
То же для депозита: карта `BALANCE` с начальным нулём потока не создаёт — фильтр
`e.amount <> 0` на верхней ветке.

---

## 5. Row Level Security

### 5.1. Проблема начальной загрузки

Апдейт Telegram содержит `telegram_id`, а не `user_id`. Значит, до разрешения пользователя
выставить `app.current_user_id` невозможно. Решение — два независимых GUC-контекста:

| Контекст | GUC | Область |
|---|---|---|
| Идентификация | `app.current_telegram_id` | только `users` — поиск и создание пользователя |
| Работа с данными | `app.current_user_id` | все пользовательские таблицы |

```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_self ON users
  USING      (telegram_id = NULLIF(current_setting('app.current_telegram_id', true), '')::bigint)
  WITH CHECK (telegram_id = NULLIF(current_setting('app.current_telegram_id', true), '')::bigint);
```

### 5.2. Политики пользовательских таблиц

```sql
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::bigint
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cards','balance_entries','dialog_states','audit_log','processed_updates']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_isolation ON %I USING (user_id = app_current_user_id())
                                       WITH CHECK (user_id = app_current_user_id())', t, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON cards, balance_entries, dialog_states, audit_log,
                                processed_updates, users TO izicrm_app;
GRANT SELECT ON v_current_balance_entries, v_capital_flows TO izicrm_app;
-- DELETE у приложения не выдаётся принципиально (A-4)

-- ADR-011: сборка мусора служебных таблиц. Финансовых таблиц в грантах нет.
GRANT SELECT, DELETE ON processed_updates, dialog_states TO izicrm_maintenance;

CREATE POLICY processed_updates_gc ON processed_updates
  FOR DELETE TO izicrm_maintenance
  USING (processed_at < now() - interval '7 days');

CREATE POLICY dialog_states_gc ON dialog_states
  FOR DELETE TO izicrm_maintenance
  USING (expires_at < now());
```

`current_setting(..., true)` возвращает `NULL`, если GUC не выставлен ⟹ условие политики ложно
⟹ **ноль строк**. Поведение fail-closed: забытый контекст ломает функциональность, а не
приватность. `NULLIF(..., '')` защищает от падения приведения пустой строки к `bigint`.

`FORCE ROW LEVEL SECURITY` распространяет политики и на владельца таблицы, поэтому обход
через владельца невозможен.

### 5.3. Unit of Work (ADR-008)

```ts
await uow.withTelegramIdentity(telegramId, async (tx) => { /* resolve/create user */ });
await uow.withUser(userId, async (tx) => { /* всё остальное */ });
```

`withUser` открывает транзакцию и выполняет
`SELECT set_config('app.current_user_id', $1, true)` — `true` означает `LOCAL`, то есть контекст
не переживает транзакцию и не может «протечь» в другое соединение из пула. Это критично:
`SET` без `LOCAL` остался бы на соединении и мог бы применить контекст одного пользователя к
запросам другого.

---

## 6. Ключевые запросы

### 6.1. LOCF-снимок на дату

```sql
SELECT DISTINCT ON (e.card_id) e.card_id, e.amount, e.effective_date
FROM v_current_balance_entries e
JOIN cards c ON c.id = e.card_id
WHERE e.user_id = $1
  AND e.effective_date <= $2
  AND c.created_on <= $2
  AND (c.archived_on IS NULL OR c.archived_on > $2)
ORDER BY e.card_id, e.effective_date DESC;
```

Возвращает строки; суммирование делает domain-слой (NFR-11). `amount` приходит **строкой** и
оборачивается в `Money`.

### 6.2. Предыдущая дата обновления

```sql
SELECT max(effective_date) AS prev_date
FROM v_current_balance_entries
WHERE user_id = $1 AND effective_date < $2;
```

### 6.3. Потоки за период

```sql
SELECT card_id, flow_date, kind, amount
FROM v_capital_flows
WHERE user_id = $1 AND flow_date BETWEEN $2 AND $3;
```

### 6.4. Вытеснение записи (исправление)

Внутри одной транзакции:

```sql
WITH inserted AS (
  INSERT INTO balance_entries (user_id, card_id, effective_date, amount, source)
  VALUES ($1, $2, $3, $4, $5) RETURNING id
)
UPDATE balance_entries be
SET superseded_at = now(), superseded_by = (SELECT id FROM inserted)
WHERE be.card_id = $2 AND be.effective_date = $3
  AND be.superseded_at IS NULL AND be.id <> (SELECT id FROM inserted);
```

Порядок важен: сначала вставка, затем вытеснение прежней. Частичный unique-индекс проверяется
в конце оператора, поэтому кратковременное наличие двух актуальных записей внутри одного
`UPDATE` допустимо, а конкурирующая транзакция получит ошибку уникальности и будет повторена.

---

## 7. Драйвер и типы

- `pg` возвращает `NUMERIC` (OID 1700) и `BIGINT` (OID 20) **строками**. Регистрировать
  type parser, превращающий их в `number`, запрещено — это молчаливая потеря точности.
- На старте выполняется assert: `pg.types.getTypeParser(1700)` возвращает идентичность для строк.
  Тест `tests/integration/pg-types.test.ts` фиксирует поведение.
- `DATE` (OID 1082) парсится в строку `YYYY-MM-DD`, а не в `Date`, чтобы исключить сдвиг таймзоны.

---

## 8. Миграции

```
migrations/
  0001_roles_and_extensions.sql
  0002_enums.sql
  0003_users.sql
  0004_cards.sql
  0005_balance_entries.sql
  0006_append_only_guards.sql
  0007_dialog_states.sql
  0008_processed_updates.sql
  0009_audit_log.sql
  0010_views.sql
  0011_row_level_security.sql
  0012_grants.sql
  0013_maintenance_role.sql
```

Правила: только вперёд, каждая миграция транзакционна и идемпотентна по проверкам;
выполняется ролью `izicrm_migrator`; на старте приложение проверяет, что все миграции
применены, иначе не поднимается. `down`-миграции пишутся, но на боевой базе не применяются
к финансовым таблицам (A-4).

---

## 9. Тесты уровня БД

| ID | Проверка |
|---|---|
| DB-01 | Два активных дубля названия ⟹ ошибка `23505` |
| DB-02 | Дубль названия при архивированной карте ⟹ разрешён (C-6) |
| DB-03 | Две актуальные записи на (карта, дата) ⟹ ошибка |
| DB-04 | `UPDATE` суммы записи ⟹ исключение триггера |
| DB-05 | `DELETE` из `balance_entries` ⟹ ноль удалённых строк |
| DB-06 | `balance_entries` с `card_id` чужого пользователя ⟹ нарушение композитного FK |
| DB-07 | Запрос без `app.current_user_id` ⟹ ноль строк во всех таблицах |
| DB-08 | Запрос с чужим `app.current_user_id` ⟹ ноль строк |
| DB-09 | `INSERT` с чужим `user_id` под RLS ⟹ нарушение `WITH CHECK` |
| DB-10 | VIEW без `security_invoker` ⟹ тест схемы падает |
| DB-11 | Роль приложения не имеет `BYPASSRLS`, `SUPERUSER` и права `DELETE` |
| DB-12 | Контекст не переживает транзакцию (проверка `LOCAL`) |
| DB-13 | LOCF-запрос корректен при пропущенных днях и вытесненных записях |
| DB-14 | `v_capital_flows` соответствует §4 модели на наборе фикстур |
| DB-15 | Все миграции применяются на чистой базе и дают ожидаемую схему |
| DB-16 | `izicrm_maintenance` не имеет `SELECT`/`DELETE` на `cards` и `balance_entries`; `DELETE` живой строки `dialog_states` (`expires_at > now()`) удаляет 0 строк |
