# izicrm

Telegram-бот для учёта балансов банковских карт и расчёта прибыли. Валюта — только рубли.

Документация: `docs/`. Порядок работы — `docs/roadmap.md`. Развёртывание на сервере — `deploy/README.md`.

## Запуск за пять команд

Нужен Node 24. Если его нет:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 24
```

Дальше в каталоге проекта:

```bash
nvm use
npm install
cp .env.example .env
npm run typecheck && npm run lint && npm test
```

Токен бота и пароли базы пишутся только в `.env`. Этот файл в git не попадает.

## Команды

| Команда | Что делает |
|---|---|
| `npm run typecheck` | проверка типов TypeScript |
| `npm run lint` | ESLint, включая запрет импортов между слоями |
| `npm test` | unit- и property-тесты |
| `npm run test:int` | интеграционные тесты (нужен Docker) |
| `npm run test:security` | изоляция пользователей и RLS (нужен Docker) |
| `npm run migrate:up` | миграции базы |
| `npm run build` | компиляция `src/` в `dist/` |
| `npm run start` | прод-запуск из `dist/main.js` |
| `npm run dev` | локальный запуск бота |

На сервере: `docker compose up -d --wait` или systemd-юнит `izicrm.service`
(после reboot поднимает стек). Подробности — `deploy/README.md`.
