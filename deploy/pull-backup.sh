#!/bin/sh
set -eu

# С Mac: забрать свежий pg_dump с VPS в ~/izicrm-backups (вне git).
# После успеха остаётся один файл izicrm-latest.dump — старые удаляются.
# Ночные дампы на сервере свои; это второй контур на другом диске.

HOST="${IZICRM_BACKUP_HOST:-root@31.76.53.4}"
REMOTE="${IZICRM_REMOTE_DIR:-/opt/izicrm}"
DEST="${IZICRM_BACKUP_DIR:-$HOME/izicrm-backups}"

mkdir -p "$DEST"
chmod 700 "$DEST"

OUT="$DEST/izicrm-latest.dump"
TMP="$DEST/izicrm-latest.dump.partial"
rm -f "$TMP"

ssh -o BatchMode=yes -o ConnectTimeout=20 "$HOST" \
  "cd '$REMOTE' && docker compose exec -T postgres pg_dump -U postgres -d izicrm -Fc --no-owner" \
  > "$TMP"

magic=$(dd if="$TMP" bs=5 count=1 2>/dev/null || true)
if [ "$magic" != "PGDMP" ]; then
  rm -f "$TMP"
  echo "pull-backup: ответ не похож на pg_dump (VPS недоступен или dump пустой)" >&2
  exit 1
fi

if [ ! -s "$TMP" ]; then
  rm -f "$TMP"
  echo "pull-backup: пустой файл" >&2
  exit 1
fi

mv "$TMP" "$OUT"
chmod 600 "$OUT"

find "$DEST" -maxdepth 1 \( -name 'izicrm-*.dump' -o -name 'izicrm-*.dump.partial' \) \
  ! -name 'izicrm-latest.dump' -delete

echo "backup ok: $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
