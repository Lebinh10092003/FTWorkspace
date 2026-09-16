#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" -eq 0 && "${REPAIR_AS_WORKSPACE:-}" != "1" ]]; then
  exec sudo -u workspace -H env REPAIR_AS_WORKSPACE=1 bash "$0"
fi

cd /var/www/ft-workspace/backend
export DJANGO_DB_PATH=/home/workspace/ft-workspace-data/workspace.sqlite3

../.venv/bin/python manage.py backup_workspace_db \
  --destination /home/workspace/ft-workspace-data/backups --keep 30

../.venv/bin/python manage.py repair_misassigned_schedule_rows --apply \
  --record-id REC-WEB-07D699417F9D \
  --record-id REC-WEB-47FF581AA8AE \
  --record-id REC-WEB-29F353DB5ACA \
  --record-id REC-WEB-40197B7D2738 \
  --record-id REC-WEB-C24C53DAB3CB \
  --record-id REC-WEB-622E3EA23EB9
