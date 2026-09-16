"""Read-only production checks; omit task contents and account credentials."""
import os
import sys
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
profiles = UserProfile.objects.filter(name__icontains="Việt Dũng")
for profile in profiles:
    print("Affected employee", profile.name, "has_manager", bool(profile.manager_id))
    print("Affected task metadata", list(WorkItem.objects.filter(executor=profile, work_date="2026-09-14").values("id", "daily_order", "status", "reviewed_at", "source_sheet_row")))
