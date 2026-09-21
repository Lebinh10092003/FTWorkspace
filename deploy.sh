#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$PROJECT_DIR/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"
SERVICE_NAME="${SERVICE_NAME:-workspace-django.service}"
SYNC_SERVICE_NAME="${SYNC_SERVICE_NAME:-workspace-social-sync.service}"
SYNC_TIMER_NAME="${SYNC_TIMER_NAME:-workspace-social-sync.timer}"
TRAINING_COMPLETION_SERVICE_NAME="${TRAINING_COMPLETION_SERVICE_NAME:-workspace-training-completion.service}"
TRAINING_COMPLETION_TIMER_NAME="${TRAINING_COMPLETION_TIMER_NAME:-workspace-training-completion.timer}"
ASSESSMENT_LIFECYCLE_SERVICE_NAME="${ASSESSMENT_LIFECYCLE_SERVICE_NAME:-workspace-assessment-lifecycle.service}"
ASSESSMENT_LIFECYCLE_TIMER_NAME="${ASSESSMENT_LIFECYCLE_TIMER_NAME:-workspace-assessment-lifecycle.timer}"
EXAM_SHEET_IMPORT_SERVICE_NAME="${EXAM_SHEET_IMPORT_SERVICE_NAME:-workspace-examination-sheet-import.service}"
EXAM_SHEET_IMPORT_TIMER_NAME="${EXAM_SHEET_IMPORT_TIMER_NAME:-workspace-examination-sheet-import.timer}"
EXAM_SHEET_EXPORT_SERVICE_NAME="${EXAM_SHEET_EXPORT_SERVICE_NAME:-workspace-examination-sheet-export.service}"
EXAM_SHEET_EXPORT_TIMER_NAME="${EXAM_SHEET_EXPORT_TIMER_NAME:-workspace-examination-sheet-export.timer}"
DB_BACKUP_SERVICE_NAME="${DB_BACKUP_SERVICE_NAME:-workspace-db-backup.service}"
DB_BACKUP_TIMER_NAME="${DB_BACKUP_TIMER_NAME:-workspace-db-backup.timer}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8001/api/health/}"
HEALTH_HOST="${HEALTH_HOST:-workspace.fermat.vn}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_DELAY_SECONDS="${HEALTH_DELAY_SECONDS:-1}"
WORKSPACE_DATA_DIR="${WORKSPACE_DATA_DIR:-/home/workspace/ft-workspace-data}"
export DJANGO_DB_PATH="${DJANGO_DB_PATH:-$WORKSPACE_DATA_DIR/workspace.sqlite3}"
DATABASE_BACKUP_DIR="${DATABASE_BACKUP_DIR:-$WORKSPACE_DATA_DIR/backups}"
DATABASE_BACKUP_KEEP="${DATABASE_BACKUP_KEEP:-30}"
LEGACY_DATABASE_PATH="$PROJECT_DIR/backend/db.sqlite3"

mkdir -p "$(dirname "$DJANGO_DB_PATH")" "$DATABASE_BACKUP_DIR"

cd "$PROJECT_DIR"
git pull --ff-only

if [ ! -x "$VENV_DIR/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install -r backend/requirements.txt

npm ci
VITE_API_URL=/api npm run build

sudo -n install -m 0644 nginx-workspace.conf /etc/nginx/sites-available/workspace.fermat.vn
sudo -n systemctl reload nginx

# On the first persistent deployment, freeze writes while the legacy database is
# copied. This prevents losing a configuration or token change made mid-deploy.
if [ ! -f "$DJANGO_DB_PATH" ] && [ -f "$LEGACY_DATABASE_PATH" ] && [ "$DJANGO_DB_PATH" != "$LEGACY_DATABASE_PATH" ]; then
  sudo systemctl stop "$SYNC_SERVICE_NAME" "$SYNC_TIMER_NAME" || true
  sudo systemctl stop "$SERVICE_NAME" || true
fi

(
  cd backend
  "$VENV_DIR/bin/python" manage.py backup_workspace_db --destination "$DATABASE_BACKUP_DIR" --keep "$DATABASE_BACKUP_KEEP"
  "$VENV_DIR/bin/python" manage.py migrate --noinput
  "$VENV_DIR/bin/python" manage.py collectstatic --noinput
)

sudo install -m 0644 workspace-django.service "/etc/systemd/system/$SERVICE_NAME"
sudo install -m 0644 workspace-social-sync.service "/etc/systemd/system/$SYNC_SERVICE_NAME"
sudo install -m 0644 workspace-social-sync.timer "/etc/systemd/system/$SYNC_TIMER_NAME"
sudo install -m 0644 workspace-schedule-sync.service /etc/systemd/system/workspace-schedule-sync.service
sudo install -m 0644 workspace-schedule-sync.timer /etc/systemd/system/workspace-schedule-sync.timer
sudo install -m 0644 workspace-examination-schedule.service /etc/systemd/system/workspace-examination-schedule.service
sudo install -m 0644 workspace-examination-schedule.timer /etc/systemd/system/workspace-examination-schedule.timer
sudo install -m 0644 workspace-training-completion.service "/etc/systemd/system/$TRAINING_COMPLETION_SERVICE_NAME"
sudo install -m 0644 workspace-training-completion.timer "/etc/systemd/system/$TRAINING_COMPLETION_TIMER_NAME"
sudo install -m 0644 workspace-assessment-lifecycle.service "/etc/systemd/system/$ASSESSMENT_LIFECYCLE_SERVICE_NAME"
sudo install -m 0644 workspace-assessment-lifecycle.timer "/etc/systemd/system/$ASSESSMENT_LIFECYCLE_TIMER_NAME"
sudo install -m 0644 workspace-examination-sheet-import.service "/etc/systemd/system/$EXAM_SHEET_IMPORT_SERVICE_NAME"
sudo install -m 0644 workspace-examination-sheet-import.timer "/etc/systemd/system/$EXAM_SHEET_IMPORT_TIMER_NAME"
sudo install -m 0644 workspace-examination-sheet-export.service "/etc/systemd/system/$EXAM_SHEET_EXPORT_SERVICE_NAME"
sudo install -m 0644 workspace-examination-sheet-export.timer "/etc/systemd/system/$EXAM_SHEET_EXPORT_TIMER_NAME"
sudo install -m 0644 workspace-db-backup.service "/etc/systemd/system/$DB_BACKUP_SERVICE_NAME"
sudo install -m 0644 workspace-db-backup.timer "/etc/systemd/system/$DB_BACKUP_TIMER_NAME"
sudo systemctl daemon-reload
sudo systemctl enable --now workspace-schedule-sync.timer
sudo systemctl enable --now workspace-examination-schedule.timer
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl enable --now "$SYNC_TIMER_NAME"
sudo systemctl enable --now "$TRAINING_COMPLETION_TIMER_NAME"
sudo systemctl enable --now "$ASSESSMENT_LIFECYCLE_TIMER_NAME"
sudo systemctl enable --now "$EXAM_SHEET_IMPORT_TIMER_NAME"
sudo systemctl enable --now "$EXAM_SHEET_EXPORT_TIMER_NAME"
sudo systemctl enable --now "$DB_BACKUP_TIMER_NAME"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl start "$ASSESSMENT_LIFECYCLE_SERVICE_NAME"

for attempt in $(seq 1 "$HEALTH_RETRIES"); do
  if curl --fail --silent --header "Host: $HEALTH_HOST" "$HEALTH_URL" >/dev/null 2>&1; then
    curl --fail --silent --show-error --header "Host: $HEALTH_HOST" "$HEALTH_URL"
    echo
    npm run prune:frontend
    echo "Deploy completed successfully."
    exit 0
  fi

  echo "Waiting for Django API ($attempt/$HEALTH_RETRIES)..."
  sleep "$HEALTH_DELAY_SECONDS"
done

echo "ERROR: Django API did not become ready at $HEALTH_URL (Host: $HEALTH_HOST)" >&2
sudo systemctl --no-pager --full status "$SERVICE_NAME" || true
exit 1
