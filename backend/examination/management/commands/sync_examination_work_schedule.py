from django.core.management.base import BaseCommand

from examination.work_schedule_sync import sync_examination_work_schedule


class Command(BaseCommand):
    help = "Đưa lịch thi các vòng vào lịch làm việc của bộ phận Khảo thí."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Ghi thay đổi. Bỏ trống để chỉ liệt kê những gì sẽ thay đổi.",
        )

    def handle(self, *args, **options):
        apply = bool(options["apply"])
        summary = sync_examination_work_schedule(apply=apply)

        if not summary["staff"]:
            self.stdout.write(self.style.WARNING(
                "Bộ phận Khảo thí chưa có nhân sự đang làm việc nào; không có gì để đồng bộ."
            ))
            return

        self.stdout.write(f"Nhân sự Khảo thí: {', '.join(summary['staff'])}")
        for kind, label in (("created", "Thêm"), ("updated", "Cập nhật"), ("deleted", "Xóa")):
            rows = summary[kind]
            self.stdout.write(f"{label}: {len(rows)}")
            for row in rows:
                extra = f" [{', '.join(row['fields'])}]" if row.get("fields") else ""
                self.stdout.write(f"    {row['date']}  {row['email']}  {row['title']}{extra}")
        if summary["skippedPast"]:
            self.stdout.write(f"Bỏ qua {summary['skippedPast']} lịch đã qua.")

        if apply:
            self.stdout.write(self.style.SUCCESS("Đã ghi thay đổi."))
        else:
            self.stdout.write(self.style.WARNING("Chạy thử: chưa ghi gì. Thêm --apply để ghi."))
