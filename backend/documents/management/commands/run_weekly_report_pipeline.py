from django.core.management.base import BaseCommand, CommandError

from documents.weekly_reports import resolve_report_week_start, run_weekly_report_pipeline


class Command(BaseCommand):
    help = "Đồng bộ Lịch công tác và tạo gói báo cáo tuần trên Google Sheets."

    def add_arguments(self, parser):
        parser.add_argument("--skip-source-sync", action="store_true")
        parser.add_argument("--week-start", help="Thứ Hai của tuần báo cáo, dạng YYYY-MM-DD.")

    def handle(self, *args, **options):
        try:
            week_start = (
                resolve_report_week_start(options["week_start"])
                if options.get("week_start") else None
            )
            result = run_weekly_report_pipeline(
                report_week_start=week_start,
                sync_source=not options["skip_source_sync"],
            )
        except Exception as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(str(result)))
