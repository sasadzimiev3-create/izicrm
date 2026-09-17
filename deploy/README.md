# Развёртывание izicrm

Бот работает в Docker Compose. systemd поднимает стек после reboot
и по таймеру чистит служебные таблицы (роль `izicrm_maintenance`, ADR-011)
и делает бэкап с **проверкой восстановления**.

## Один раз на сервере

Нужны Docker, Docker Compose v2 и systemd.

```bash
sudo mkdir -p /opt/izicrm
sudo git clone <repo> /opt/izicrm
cd /opt/izicrm
sudo cp .env.example .env
sudo chmod 600 .env
# заполнить TELEGRAM_BOT_TOKEN и пароли в .env
```

Юниты:

```bash
sudo cp deploy/systemd/izicrm.service /etc/systemd/system/
sudo cp deploy/systemd/izicrm-gc.service /etc/systemd/system/
sudo cp deploy/systemd/izicrm-gc.timer /etc/systemd/system/
sudo cp deploy/systemd/izicrm-backup.service /etc/systemd/system/
sudo cp deploy/systemd/izicrm-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now izicrm.service
sudo systemctl enable --now izicrm-gc.timer
sudo systemctl enable --now izicrm-backup.timer
```

`WantedBy=multi-user.target` у `izicrm.service` — после reboot Docker
поднимает postgres и бота, миграции применяются, health-check отвечает.

Проверка:

```bash
docker compose ps
docker compose exec -T bot node dist/infrastructure/ops/health-cli.js
sudo systemctl is-enabled izicrm.service
```

Попытка запустить бота под ролью с `SUPERUSER` или `BYPASSRLS`
завершается ошибкой на старте (`docs/database.md` §2).

## Очистка служебных таблиц

Таймер вызывает `deploy/gc.sh` внутри контейнера postgres **под
`izicrm_maintenance`**. Живой диалог (`expires_at > now()`) этой ролью
удалить нельзя — политика RLS (DB-16). Бот права `DELETE` не имеет.

## Бэкап

Каждую ночь `deploy/backup.sh` делает `pg_dump -Fc` и сразу восстанавливает
дамп во временную базу `izicrm_restore_verify`. Если восстановление
не проходит, unit падает — бэкап без проверки не считается сделанным.

WAL архивируется в volume `backups/wal` (`wal_level=replica`, `archive_mode=on`).
Логический дамп — основной путь восстановления:

```bash
docker compose stop bot
docker compose exec -T postgres /ops/restore.sh /backups/izicrm-YYYYMMDDThhmmssZ.dump
docker compose start bot
```

PITR: остановить postgres, вернуть базовый бэкап каталога данных, положить
WAL из `backups/wal`, создать `recovery.signal`. Регламент проверки — ежедневный
логический restore-verify; PITR держат как второй контур.

Второй контур — Mac оператора (не git). С ноутбука:

```bash
./deploy/pull-backup.sh
```

Дамп пишется в `~/izicrm-backups/` (права `700` на каталог, `600` на файл).
LaunchAgent раз в день в 11:00, **если Mac включён**:

```bash
DEST="$HOME/izicrm-backups"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/pull-backup.sh"
# или из корня репозитория:
install -d "$HOME/Library/LaunchAgents" "$DEST"
sed -e "s|__SCRIPT__|$PWD/deploy/pull-backup.sh|" \
    -e "s|__LOG__|$DEST/pull.log|" \
    deploy/macos/ru.izicrm.pull-backup.plist \
  > "$HOME/Library/LaunchAgents/ru.izicrm.pull-backup.plist"
launchctl bootout "gui/$(id -u)/ru.izicrm.pull-backup" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/ru.izicrm.pull-backup.plist"
```

Финансовые дампы в GitHub не класть. Если Mac спит в 11:00 — запуск пропускается,
можно дернуть `./deploy/pull-backup.sh` вручную.

## Локально

```bash
cp .env.example .env
docker compose up -d --build --wait
```

Токен бота обязателен: без него контейнер `bot` не проходит старт.
Если с VPS недоступен `api.telegram.org`, задайте в `.env`:

```bash
TELEGRAM_PROXY_URL=http://user:pass@host:8000
```

Compose передаёт переменную только сервису `bot`. Health слушает `127.0.0.1:8080` внутри контейнера, с хоста не публикуется.
