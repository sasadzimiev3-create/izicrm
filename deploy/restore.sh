#!/bin/sh
set -eu

# Восстановление логического дампа в текущую базу. Останавливает бота.
# PITR: WAL лежит в volume backups/wal; см. deploy/README.md.

DUMP=${1:-}
if [ -z "$DUMP" ]; then
  echo "usage: restore.sh /backups/izicrm-YYYYMMDDThhmmssZ.dump" >&2
  exit 1
fi

psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'izicrm' AND pid <> pg_backend_pid();"
dropdb --if-exists -U postgres izicrm
createdb -U postgres izicrm
pg_restore -U postgres -d izicrm --no-owner --no-acl "$DUMP"
echo "restored $DUMP"
