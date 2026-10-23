"""Command xử lý hàng đợi outbox đồng bộ Đăng ký dịch vụ với Google Sheet."""
from django.core.management.base import BaseCommand

from digital_training.subscription_queue import drain_subscription_sheet_queue


class Command(BaseCommand):
    help = "Đồng bộ các thay đổi trong hàng đợi đăng ký dịch vụ ra Google Sheet"

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=50, help="Số lượng bản ghi tối đa xử lý mỗi lần")

    def handle(self, *args, **options):
        limit = options.get("limit") or 50
        summary = drain_subscription_sheet_queue(limit=limit)
        self.stdout.write(self.style.SUCCESS(f"Kết quả xử lý hàng đợi: {summary}"))
