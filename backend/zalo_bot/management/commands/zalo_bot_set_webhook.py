from django.conf import settings
from django.core.management.base import BaseCommand
from zalo_bot.client import ZaloBotClient


class Command(BaseCommand):
    help = "Cài đặt, kiểm tra hoặc xóa webhook Zalo Bot Platform"

    def add_arguments(self, parser):
        parser.add_argument("--url", type=str, help="URL nhận webhook (HTTPS)")
        parser.add_argument("--secret", type=str, help="Secret token (mặc định lấy từ settings)")
        parser.add_argument("--delete", action="store_true", help="Xóa webhook hiện tại")
        parser.add_argument("--info", action="store_true", help="Xem thông tin webhook hiện tại")

    def handle(self, *args, **options):
        client = ZaloBotClient()

        if options["info"]:
            info = client.get_webhook_info()
            self.stdout.write(self.style.SUCCESS(f"Webhook Info: {info}"))
            return

        if options["delete"]:
            res = client.delete_webhook()
            self.stdout.write(self.style.SUCCESS(f"Delete Webhook Result: {res}"))
            return

        url = options.get("url")
        if not url:
            self.stderr.write(self.style.ERROR("Vui lòng cung cấp --url hoặc chọn --info / --delete"))
            return

        secret = options.get("secret") or getattr(settings, "ZALO_BOT_WEBHOOK_SECRET", None)
        res = client.set_webhook(url=url, secret_token=secret)
        self.stdout.write(self.style.SUCCESS(f"Set Webhook Result: {res}"))
