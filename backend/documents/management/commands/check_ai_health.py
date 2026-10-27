"""Management command to check health of agy/Gemini session on VPS."""

from django.core.management.base import BaseCommand

from documents.ai_service import check_ai_service_health


class Command(BaseCommand):
    help = "Kiểm tra phiên kết nối và sức khỏe dịch vụ AI (agy/Gemini)."

    def handle(self, *args, **options):
        self.stdout.write("Đang kiểm tra kết nối dịch vụ AI...")
        health = check_ai_service_health()
        status_style = self.style.SUCCESS if health.status == "ready" else self.style.ERROR

        self.stdout.write(status_style(f"Trạng thái: {health.get_status_display()} ({health.status})"))
        self.stdout.write(f"Thời điểm kiểm tra: {health.last_checked_at}")
        self.stdout.write(f"Lần sẵn sàng gần nhất: {health.last_ready_at or 'Chưa có'}")
        self.stdout.write(f"Số ngày phiên sống: {health.session_days_alive()} ngày")
        if health.error_message:
            self.stdout.write(self.style.WARNING(f"Lỗi: {health.error_message}"))
