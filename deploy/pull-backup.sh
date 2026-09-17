#!/bin/sh
set -eu

# С Mac: забрать свежий pg_dump с VPS в ~/izicrm-backups (вне git).
# Ночные дампы на сервере остаются; это второй контур на другом диске.

HOST="${IZICRM_BACKUP_HOST:-root@31.76.53.4}"
REMOTE="${IZICRM_REMOTE_DIR:-/opt/izicrm}"
DEST="${IZICRM_BACKUP_DIR:-$HOME/izicrm-backups}"
KEEP="${IZICRM_BACKUP_KEEP:-14}"

mkdir -p "$DEST"
chmod 700 "$DEST"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DEST/izicrm-${STAMP}.dump"
TMP="$OUT.partial"

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
echo "backup ok: $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"

# shellcheck disable=SC2012
old=$(ls -1t "$DEST"/izicrm-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" || true)
if [ -n "$old" ]; then
  echo "$old" | while IFS= read -r f; do
    rm -f "$f"
  done
fi
