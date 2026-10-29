"""Cleanup expired WeeklyReportSupplement rows where week_start + 7 days has elapsed."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from documents.models import WeeklyReportSupplement
from documents.weekly_reports import week_start

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Delete WeeklyReportSupplement rows whose reporting week has ended (week_start + 7 days passed)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show records that would be deleted without actually deleting them.",
        )

    def handle(self, *args, **options):
        dry_run = options.get("dry_run", False)
        today = timezone.localdate()
        current_week_monday = week_start(today)

        # A reporting week ends when the next Monday begins (week_start + 7 days)
        # Any supplement with week_start < current_week_monday is expired.
        cutoff_date = current_week_monday
        expired_qs = WeeklyReportSupplement.objects.filter(week_start__lt=cutoff_date)
        count = expired_qs.count()

        self.stdout.write(
            f"Checking expired supplements at {today.isoformat()} (Current week Monday: {cutoff_date.isoformat()}). "
            f"Found {count} expired supplement(s)."
        )

        if dry_run:
            for supp in expired_qs:
                self.stdout.write(
                    f"  [DRY-RUN] Would delete supplement for {supp.user.email} (week_start={supp.week_start}, attachments={len(supp.attachments or [])})"
                )
            self.stdout.write(self.style.SUCCESS(f"Dry run completed. {count} record(s) identified."))
            return

        deleted_total = 0
        if count > 0:
            deleted_total, _ = expired_qs.delete()
            logger.info("Cleaned up %d expired WeeklyReportSupplement rows (cutoff: %s)", deleted_total, cutoff_date)

        self.stdout.write(
            self.style.SUCCESS(f"Cleanup finished: successfully deleted {deleted_total} expired supplement record(s).")
        )
