"""
Management command to clean up email digests older than 30 days.
Runs daily via systemd timer.
"""

from django.core.management.base import BaseCommand
from gmail_assistant.sync import cleanup_old_digests


class Command(BaseCommand):
    help = "Dọn dẹp bản ghi tóm tắt email cũ hơn 30 ngày để tối ưu dung lượng lưu trữ."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=30,
            help="Số ngày giữ lại bản ghi tóm tắt (mặc định 30 ngày).",
        )

    def handle(self, *args, **options):
        days = options.get("days") or 30
        deleted_count = cleanup_old_digests(days=days)
        self.stdout.write(
            self.style.SUCCESS(
                f"Đã dọn dẹp thành công {deleted_count} bản ghi tóm tắt email cũ hơn {days} ngày."
            )
        )
