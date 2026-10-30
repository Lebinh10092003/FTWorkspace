"""
Management command for daily morning email scan.
Runs every 10 minutes via systemd timer, checking if current ICT time is at or past user's morning_time.
Idempotent per user per calendar day.
"""

from datetime import datetime
import logging
import zoneinfo

from django.core.management.base import BaseCommand
from django.utils import timezone

from gmail_assistant.models import GmailConnection
from gmail_assistant.sync import ICT_TZ, run_morning_scan_for_user

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Quét tổng hợp thư buổi sáng (thư 24h qua + thư tuần chưa phản hồi) theo giờ cài đặt ICT."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Bỏ qua kiểm tra giờ và ngày, buộc chạy quét buổi sáng ngay lập tức.",
        )
        parser.add_argument(
            "--user-email",
            type=str,
            default="",
            help="Chỉ quét cho một người dùng cụ thể.",
        )

    def handle(self, *args, **options):
        force = bool(options.get("force"))
        target_email = (options.get("user_email") or "").strip().lower()

        now_ict = timezone.now().astimezone(ICT_TZ)
        current_time_str = now_ict.strftime("%H:%M")
        today = now_ict.date()

        queryset = GmailConnection.objects.select_related("user").all()
        if not force:
            queryset = queryset.filter(morning_scan_enabled=True)
        if target_email:
            queryset = queryset.filter(user__email__iexact=target_email)

        scanned_count = 0
        skipped_count = 0

        for conn in queryset:
            # Check if user's scheduled time has arrived today
            target_time_str = conn.morning_time or "08:00"
            if not force:
                if conn.last_morning_date == today:
                    skipped_count += 1
                    continue
                if current_time_str < target_time_str:
                    # Scheduled time has not arrived yet
                    skipped_count += 1
                    continue

            try:
                ran = run_morning_scan_for_user(conn, now_ict=now_ict)
                if ran:
                    scanned_count += 1
                    self.stdout.write(f"[{conn.user.email}] Đã gửi thông báo digest buổi sáng.")
                else:
                    skipped_count += 1
            except Exception as exc:
                self.stderr.write(self.style.ERROR(f"[{conn.user.email}] Lỗi quét sáng: {exc}"))

        self.stdout.write(
            self.style.SUCCESS(
                f"Quét sáng hoàn thành lúc {current_time_str} ICT: {scanned_count} người nhận thông báo, {skipped_count} bỏ qua."
            )
        )
