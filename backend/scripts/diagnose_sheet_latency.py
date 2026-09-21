"""Read-only: how fast does a work-schedule edit reach the Sheet, and does it?

Answers two different complaints that look the same from the outside:

  "chậm"        -> the queue drains, but only when the 2-minute timer fires,
                   because the immediate worker a save starts never ran.
  "không lên"   -> the queue says done while the Sheet has no such row.

Prints no task text: titles are compared by count and by hash only.
"""
import os
import sys
from collections import Counter
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django

django.setup()

from django.utils import timezone  # noqa: E402

from work_schedule.models import WorkItem, WorkScheduleSheetChange, WorkScheduleSheetSyncLease  # noqa: E402

now = timezone.now()

# ---- 1. How long does a queued change wait before it is processed? ---------
done = list(
    WorkScheduleSheetChange.objects
    .filter(status="done", processed_at__isnull=False)
    .order_by("-processed_at")[:300]
)
waits = sorted((row.processed_at - row.created_at).total_seconds() for row in done)
if waits:
    def pct(fraction):
        return round(waits[min(len(waits) - 1, int(len(waits) * fraction))], 1)
    print("Queue wait seconds  n=%d  min=%.1f  p50=%.1f  p90=%.1f  max=%.1f"
          % (len(waits), waits[0], pct(0.5), pct(0.9), waits[-1]))
    # The immediate worker fires ~1s after commit; the timer every 120s.
    fast = sum(1 for value in waits if value <= 15)
    print("Handled within 15s: %d/%d (%.0f%%) -- the rest waited for the timer"
          % (fast, len(waits), 100.0 * fast / len(waits)))
else:
    print("Queue wait seconds: no processed rows to measure")

print("Queue rows by status", dict(Counter(
    WorkScheduleSheetChange.objects.values_list("status", flat=True))))
for window, label in ((timedelta(hours=1), "last hour"), (timedelta(days=1), "last day")):
    recent = WorkScheduleSheetChange.objects.filter(created_at__gte=now - window)
    print("Queued in the %s: %d  (still pending: %d)"
          % (label, recent.count(), recent.filter(status="pending").count()))

# ---- 2. Is anything waiting right now, and for how long? -------------------
oldest = WorkScheduleSheetChange.objects.exclude(status="done").order_by("created_at").first()
if oldest:
    print("Oldest unfinished change: status=%s age=%.1fs attempts=%d"
          % (oldest.status, (now - oldest.created_at).total_seconds(), oldest.attempts))
    print("Its last error present:", bool((oldest.last_error or "").strip()))
else:
    print("Oldest unfinished change: none, the queue is empty")

lease = WorkScheduleSheetSyncLease.objects.filter(key="ft-work-schedule").first()
print("Sync lease locked_until:", getattr(lease, "locked_until", None))

# ---- 3. Does the Sheet actually hold what the database holds? --------------
from work_schedule.sheet_sync import _rows, _service, _sheet_columns, _spreadsheet_id  # noqa: E402

print("Target spreadsheet:", _spreadsheet_id())
try:
    service = _service()
    columns, _ = _sheet_columns(service)
    rows = _rows(service, start_row=3)
    from work_schedule.sheet_sync import _cell, _parse_date  # noqa: E402

    sheet_groups = {}
    for row in rows:
        row_date = _parse_date(_cell(row, columns.get("date", -1)))
        staff = _cell(row, columns.get("staff", -1)).strip()
        if row_date and staff:
            content = _cell(row, columns.get("content", -1))
            sheet_groups[(staff.casefold(), row_date)] = len(
                [line for line in str(content).splitlines() if line.strip()])
    print("Sheet rows read: %d  dated staff groups: %d" % (len(rows), len(sheet_groups)))
    sheet_dates = sorted({value[1] for value in sheet_groups})
    if sheet_dates:
        print("Sheet date range: %s .. %s" % (sheet_dates[0], sheet_dates[-1]))
        future = [value for value in sheet_dates if value > timezone.localdate()]
        print("Sheet dates after today: %d (max %s)"
              % (len(future), future[-1] if future else "none"))
    staff_counts = Counter(name for name, _ in sheet_groups)
    print("Sheet staff names (top 8):", staff_counts.most_common(8))
    print("Retention start:", __import__("work_schedule.retention", fromlist=["retained_from"]).retained_from())

    # Compare the groups the database changed most recently.
    recent_items = (WorkItem.objects
                    .select_related("executor")
                    .order_by("-updated_at")[:400])
    seen, missing, mismatched, matched = set(), 0, 0, 0
    examples = []
    for item in recent_items:
        key = (item.executor.name or "", item.work_date)
        if key in seen:
            continue
        seen.add(key)
        db_count = WorkItem.objects.filter(executor=item.executor, work_date=item.work_date).count()
        found = sheet_groups.get((str(key[0]).casefold(), key[1]))
        if found is None:
            missing += 1
            if len(examples) < 8:
                examples.append("missing  %s  %s  db=%d" % (key[1], key[0][:18], db_count))
        elif found != db_count:
            mismatched += 1
            if len(examples) < 8:
                examples.append("count    %s  %s  db=%d sheet=%d" % (key[1], key[0][:18], db_count, found))
        else:
            matched += 1
    print("Recent groups compared: matched=%d mismatched=%d missing_from_sheet=%d"
          % (matched, mismatched, missing))
    for line in examples:
        print("   ", line)
except Exception as exc:  # noqa: BLE001 - diagnostics must not mask the reason
    print("Sheet read failed:", type(exc).__name__, str(exc)[:300])
