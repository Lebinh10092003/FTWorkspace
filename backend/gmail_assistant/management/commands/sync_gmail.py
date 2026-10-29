"""
Management command to sync new emails for all active Gmail connections.
Runs every 5 minutes via systemd timer or cron.
"""

import logging
from django.core.management.base import BaseCommand
from gmail_assistant.models import GmailConnection
from gmail_assistant.sync import sync_user_gmail

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Đồng bộ thư mới từ Gmail và phân loại tóm tắt qua hàng đợi AI."

    def add_arguments(self, parser):
        parser.add_argument(
            "--max-fetch",
            type=int,
            default=20,
            help="Số lượng thư tối đa mỗi người dùng trong một lượt quét (mặc định 20).",
        )
        parser.add_argument(
            "--user-email",
            type=str,
            default="",
            help="Chỉ đồng bộ cho một người dùng cụ thể.",
        )

    def handle(self, *args, **options):
        max_fetch = options.get("max_fetch") or 20
        target_email = (options.get("user_email") or "").strip().lower()

        queryset = GmailConnection.objects.select_related("user").all()
        if target_email:
            queryset = queryset.filter(user__email__iexact=target_email)

        total_synced = 0
        total_errors = 0

        for conn in queryset:
            try:
                res = sync_user_gmail(conn, max_fetch=max_fetch)
                new_count = res.get("new_count", 0)
                needs_reply = res.get("needs_reply_count", 0)
                self.stdout.write(
                    f"[{conn.user.email}] Đồng bộ thành công: {new_count} thư mới, {needs_reply} cần phản hồi."
                )
                total_synced += new_count
            except Exception as exc:
                total_errors += 1
                self.stderr.write(self.style.ERROR(f"[{conn.user.email}] Lỗi đồng bộ: {exc}"))

        self.stdout.write(
            self.style.SUCCESS(
                f"Hoàn thành sync_gmail: {queryset.count()} kết nối, {total_synced} thư mới, {total_errors} lỗi."
            )
        )
