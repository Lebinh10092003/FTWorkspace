"""Read-only production checks; omit task contents and account credentials."""
import os
import sys
import re
import subprocess
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from django.db import connection
from django.db.models import Count
from authentication.models import UserProfile
from work_schedule.models import WorkItem, WorkScheduleSheetChange

with connection.cursor() as cursor:
    for statement in ["PRAGMA quick_check", "PRAGMA journal_mode", "PRAGMA busy_timeout"]:
        cursor.execute(statement)
        print(statement, cursor.fetchall())
print("Task status counts", list(WorkItem.objects.values("status").annotate(count=Count("id"))))
print("Sheet queue counts", list(WorkScheduleSheetChange.objects.values("status").annotate(count=Count("id"))))
queue = WorkScheduleSheetChange.objects.exclude(status="done")
print("Queue error category counts", {name: queue.filter(last_error__icontains=marker).count() for name, marker in [("sqlite_locked", "database is locked"), ("google_quota", "429"), ("google_quota_text", "Quota exceeded")]})
from django.utils import timezone
from datetime import timedelta
print("Stale processing count", queue.filter(status="processing", created_at__lt=timezone.now() - timedelta(minutes=30)).count())
print("Reviewed tasks count", WorkItem.objects.filter(reviewed_at__isnull=False).count())
print("Active employees without manager count", UserProfile.objects.filter(employment_status="ACTIVE", manager__isnull=True).count())
# Never print raw journal lines: they may contain HR data, request URLs or tokens.
result = subprocess.run(["sudo", "-n", "journalctl", "-u", "workspace-django.service", "--since", "24 hours ago", "--no-pager", "-n", "5000"], capture_output=True, text=True)
if result.returncode:
    print("Journal access unavailable")
else:
    log = result.stdout
    print("Exception type counts", dict(Counter(re.findall(r"\b([A-Za-z]+Error):", log))))
    print("Database lock error count", log.count("database is locked"))
    print("Worker timeout count", log.count("WORKER TIMEOUT"))
    print("Out of memory count", log.lower().count("out of memory"))
    frames = re.findall(r'File "(/var/www/ft-workspace/[^"\n]+\.py)", line (\d+), in (\w+)', log)
    print("Application stack locations", dict(Counter(f"{Path(file).name}:{line}:{function}" for file, line, function in frames)))
