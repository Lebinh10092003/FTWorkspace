"""Refresh existing Sheet rows for high-priority tasks created on the Web."""

from django.core.management.base import BaseCommand, CommandError

from work_schedule.models import WorkItem, WorkScheduleSheetChange
from work_schedule.retention import retained_from
from work_schedule.sheet_sync import sync_to_sheet


class Command(BaseCommand):
    help = "Cập nhật định dạng Sheet theo quy tắc ưu tiên cao và nhãn [Hỗ trợ]."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Xếp hàng và đồng bộ những dòng cần sửa.")

    def handle(self, *args, **options):
        groups = {
            (item.executor_id, item.work_date)
            for item in WorkItem.objects.filter(
                work_date__gte=retained_from(),
                priority="high",
                sheet_emphasis__isnull=True,
                sheet_last_editor_email="",
            ).only("executor_id", "work_date", "title_format_runs")
            if not item.title_format_runs
        }
        if not groups:
            self.stdout.write("Không có dòng ưu tiên cao nào cần cập nhật định dạng.")
            return
        if not options["apply"]:
            self.stdout.write(f"Có {len(groups)} dòng cần cập nhật. Chạy với --apply để ghi.")
            return

        WorkScheduleSheetChange.objects.bulk_create([
            WorkScheduleSheetChange(executor_email=email, work_date=work_date)
            for email, work_date in sorted(groups)
        ])
        try:
            result = sync_to_sheet()
        except Exception as exc:
            raise CommandError(f"Đã xếp hàng nhưng chưa đồng bộ được: {exc}") from exc
        target_keys = {(email, work_date.isoformat()) for email, work_date in groups}
        target_conflicts = any(
            (conflict.get("email"), str(conflict.get("date"))) in target_keys
            for conflict in result.get("conflicts", [])
        )
        if result.get("busy") or target_conflicts:
            raise CommandError(f"Đã xếp hàng nhưng chưa đồng bộ hết: {result}")
        self.stdout.write(self.style.SUCCESS(f"Đã cập nhật {len(groups)} dòng ưu tiên cao trong Sheet."))
