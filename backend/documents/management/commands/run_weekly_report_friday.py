from django.core.management.base import BaseCommand, CommandError

from documents.weekly_report_drive import archive_week_reports, run_friday_weekly_reports


class Command(BaseCommand):
    help = (
        "Lượt báo cáo tuần 16:00 thứ Sáu: làm mới bản nháp từ Lịch công tác, lưu Word vào "
        "thư mục TUAN NN trên Google Drive và gửi AI viết lại (AI xong tự cập nhật file Drive)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--week",
            type=int,
            help="Chỉ lưu lại lên Drive các báo cáo đã có của tuần này (không làm mới bản nháp, không gọi AI).",
        )

    def handle(self, *args, **options):
        try:
            if options.get("week"):
                result = archive_week_reports(options["week"])
                result["week"] = options["week"]
                result["aiQueued"] = 0
            else:
                result = run_friday_weekly_reports()
        except Exception as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(
            f"Tuần {result['week']}: lưu {len(result['saved'])}, bỏ qua {len(result['skipped'])}, "
            f"lỗi {len(result['failed'])}, gửi AI {result['aiQueued']}."
        )
        for row in result["saved"]:
            self.stdout.write(f"  [Đã lưu] {row['employee']}: {row['file']}")
        for row in result["skipped"]:
            self.stdout.write(f"  [Bỏ qua] {row['employee']}: {row['reason']}")
        for row in result["failed"]:
            self.stdout.write(self.style.ERROR(f"  [Lỗi] {row['employee']}: {row['error']}"))
