from datetime import date

from django.utils import timezone


RETENTION_MONTHS = 3


def retained_from(value=None):
    """First day kept locally: current month plus the two preceding months."""
    value = value or timezone.localdate()
    month_index = value.year * 12 + value.month - 1 - (RETENTION_MONTHS - 1)
    return date(month_index // 12, month_index % 12 + 1, 1)


def notification_from(value=None):
    """Unfinished-task reminders include the retained history across months."""
    return retained_from(value)


def purge_expired_work_schedule(value=None):
    """Delete expired web history while leaving the long-term Sheet archive intact."""
    from .models import WorkItem, WorkScheduleSheetChange, WorkScheduleSheetInboundEvent
    from .signals import suppress_sheet_queue

    cutoff = retained_from(value)
    with suppress_sheet_queue():
        deleted_items, _ = WorkItem.objects.filter(work_date__lt=cutoff).delete()
    WorkScheduleSheetChange.objects.filter(work_date__lt=cutoff).delete()
    WorkScheduleSheetInboundEvent.objects.filter(received_at__date__lt=cutoff).delete()
    return {"retentionStart": cutoff.isoformat(), "deletedItems": deleted_items}
