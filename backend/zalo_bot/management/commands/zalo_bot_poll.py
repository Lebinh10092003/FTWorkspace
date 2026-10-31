import time
from django.core.management.base import BaseCommand
from zalo_bot.client import ZaloBotClient
from zalo_bot.models import ZaloInboundEvent
from zalo_bot.services import handle_inbound_message


class Command(BaseCommand):
    help = "Polling tin nhắn từ Zalo Bot Platform (dự phòng khi không dùng Webhook)"

    def add_arguments(self, parser):
        parser.add_argument("--interval", type=int, default=2, help="Khoảng thời gian polling (giây)")
        parser.add_argument("--once", action="store_true", help="Chỉ chạy polling 1 lần rồi kết thúc")

    def handle(self, *args, **options):
        client = ZaloBotClient()
        interval = options["interval"]
        once = options["once"]

        self.stdout.write(self.style.SUCCESS("Bắt đầu polling Zalo Bot updates... (Ctrl+C để dừng)"))
        offset = None

        while True:
            try:
                res = client.get_updates(offset=offset, timeout=5)
                if res.get("ok"):
                    updates = res.get("result") or []
                    for upd in updates:
                        upd_id = upd.get("update_id")
                        if upd_id:
                            offset = upd_id + 1

                        msg = upd.get("message") or upd.get("edited_message") or {}
                        if not msg:
                            continue

                        msg_id = str(msg.get("message_id") or upd_id or "")
                        chat = msg.get("chat") or {}
                        chat_id = str(chat.get("id") or msg.get("from", {}).get("id") or "")
                        text = str(msg.get("text") or "").strip()
                        from_user = msg.get("from") or {}

                        if not chat_id or not text:
                            continue

                        # Idempotent check
                        if msg_id:
                            if ZaloInboundEvent.objects.filter(message_id=msg_id).exists():
                                continue
                            ZaloInboundEvent.objects.create(message_id=msg_id, chat_id=chat_id)

                        handle_inbound_message(chat_id=chat_id, text=text, from_user=from_user)
                        self.stdout.write(f"Processed message from {chat_id}")

                if once:
                    break

                time.sleep(interval)
            except KeyboardInterrupt:
                self.stdout.write("\nDừng polling.")
                break
            except Exception as e:
                self.stderr.write(f"Lỗi polling: {e}")
                if once:
                    break
                time.sleep(interval)
