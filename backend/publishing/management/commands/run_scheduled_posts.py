"""Management command to process and publish scheduled post variants."""

import logging
from django.core.management.base import BaseCommand
from publishing.service import run_scheduled_posts

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Quét và phát hành các bài đăng truyền thông đã đến lịch hẹn (chạy định kỳ 5 phút)."

    def handle(self, *args, **options):
        self.stdout.write("Bắt đầu quét các bài đăng đến giờ phát hành...")
        res = run_scheduled_posts()
        self.stdout.write(
            self.style.SUCCESS(
                f"Hoàn thành: Đã quét {res['scanned']}, Thành công: {res['published']}, "
                f"Chờ đăng tay: {res['awaiting_manual']}, Thất bại: {res['failed']}, "
                f"Bỏ qua: {res['skipped']}."
            )
        )
