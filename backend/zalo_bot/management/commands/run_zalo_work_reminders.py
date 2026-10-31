from django.core.management.base import BaseCommand
from zalo_bot.reminders import run_work_reminders


class Command(BaseCommand):
    help = "Quét và gửi nhắc việc lịch công tác hôm nay / quá hạn qua Zalo"

    def handle(self, *args, **options):
        self.stdout.write("Bắt đầu quét nhắc việc lịch công tác...")
        result = run_work_reminders()
        self.stdout.write(
            self.style.SUCCESS(
                f"Hoàn thành: Đã nhắc {result['total_reminded']} việc "
                f"(Tổng liên kết: {result['total_links']}, Bỏ qua yên lặng: {result['skipped_quiet']}, "
                f"Bỏ qua trần: {result['skipped_cap']})"
            )
        )
