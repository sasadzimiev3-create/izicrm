#!/bin/sh
set -eu

# Регламент ADR-011: DELETE только под izicrm_maintenance, не под ботом.
# Скрипт рассчитан на запуск внутри контейнера postgres (systemd-timer).

if [ -z "${IZICRM_MAINTENANCE_PASSWORD:-}" ]; then
  echo "IZICRM_MAINTENANCE_PASSWORD is required" >&2
  exit 1
fi

PGPASSWORD="$IZICRM_MAINTENANCE_PASSWORD" psql \
  -U izicrm_maintenance \
  -d izicrm \
  -v ON_ERROR_STOP=1 \
  -f /ops/gc.sql
