"""Revisit generated exam rows after the Sheet roster format changes."""
from django.core.management.base import BaseCommand
from django.utils import timezone

from work_schedule.models import WorkItem, WorkScheduleSheetChange


class Command(BaseCommand):
    help = 'Queue future Khảo thí schedule rows for weekday and staff-label normalization.'

    def handle(self, *args, **options):
        rows = WorkItem.objects.filter(
            source_record_id__startswith='REC-EXAM-',
            work_date__gte=timezone.localdate(),
        ).values_list('executor_id', 'work_date').distinct()
        queued = 0
        for email, work_date in rows:
            pending = WorkScheduleSheetChange.objects.filter(
                executor_email=email, work_date=work_date,
                status__in=['pending', 'processing', 'failed', 'conflict'],
            ).exists()
            if not pending:
                WorkScheduleSheetChange.objects.create(executor_email=email, work_date=work_date)
                queued += 1
        self.stdout.write(f'Queued {queued} exam schedule groups for formatting.')
