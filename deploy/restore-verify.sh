#!/bin/sh
set -eu

DUMP=$1
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "usage: restore-verify.sh /path/to/izicrm.dump" >&2
  exit 1
fi

DB=izicrm_restore_verify
dropdb --if-exists -U postgres "$DB"
createdb -U postgres "$DB"
pg_restore -U postgres -d "$DB" --no-owner --no-acl "$DUMP"
psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM pgmigrations;"
psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM balance_entries;"
psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM cards;"
dropdb -U postgres "$DB"
echo "restore verification ok: $DUMP"
