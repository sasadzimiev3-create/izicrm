#!/bin/sh
set -eu

# Ежедневный логический бэкап + проверка восстановления на временной базе.
# Бэкап, из которого ни разу не восстанавливались, бэкапом не является.

mkdir -p /backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP=/backups/izicrm-${STAMP}.dump

pg_dump -U postgres -d izicrm -Fc --no-owner -f "$DUMP"
/ops/restore-verify.sh "$DUMP"

# Хранить 14 суток.
find /backups -maxdepth 1 -name 'izicrm-*.dump' -mtime +14 -delete
echo "backup ok: $DUMP"
