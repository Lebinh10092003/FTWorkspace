import logging
from django.utils import timezone

from work_schedule.models import WorkItem

from .client import ZaloBotClient
from .models import ZaloLink, ZaloPendingAction, ZaloReminderHistory, ZaloSendLog
from .services import _save_task_index_map, check_send_limits, is_in_quiet_hours

logger = logging.getLogger(__name__)


def run_work_reminders(now=None) -> dict:
    """
    Quét và gửi thông báo nhắc việc lịch công tác cho người dùng đã liên kết Zalo:
    - Chỉ chạy trong giờ làm việc (hoặc khi không rơi vào khung giờ yên lặng của người đó)
    - Chỉ nhắc việc của CHÍNH HỌ (executor=link.user)
    - Việc hôm nay hoặc quá hạn chưa hoàn thành (STATUS_TODO, STATUS_DOING)
    - Mỗi việc chỉ nhắc tối đa 1 lần / ngày (kiểm tra ZaloReminderHistory)
    - Không tự đổi lịch khi chưa được người dùng xác nhận
    """
    now = now or timezone.now()
    today = timezone.localdate(now)

    active_links = list(
        ZaloLink.objects.filter(
            is_enabled=True,
            notify_schedule=True,
        ).select_related("user")
    )

    client = ZaloBotClient()
    total_reminded = 0
    skipped_quiet = 0
    skipped_cap = 0

    for link in active_links:
        user = link.user

        # 1. Bỏ qua nếu đang trong khung giờ yên lặng
        if is_in_quiet_hours(link, check_dt=now):
            skipped_quiet += 1
            continue

        # 2. Kiểm tra hạn mức gửi
        allowed, reason = check_send_limits(user, category="work_reminder", now=now)
        if not allowed:
            skipped_cap += 1
            continue

        # 3. Lấy việc hôm nay hoặc quá hạn chưa hoàn thành của chính user này
        uncompleted_items = list(
            WorkItem.objects.filter(
                executor=user,
                work_date__lte=today,
                status__in=[WorkItem.STATUS_TODO, WorkItem.STATUS_DOING],
            ).order_by("work_date", "daily_order", "start_time")
        )

        if not uncompleted_items:
            continue

        # 4. Lọc việc chưa nhắc hôm nay
        already_reminded_ids = set(
            ZaloReminderHistory.objects.filter(
                user=user,
                reminder_date=today,
            ).values_list("work_item_id", flat=True)
        )

        items_to_remind = [it for it in uncompleted_items if it.id not in already_reminded_ids]
        if not items_to_remind:
            continue

        # Để tiết kiệm quota tin nhắn (trần tháng 2500 tin), gom tối đa 3 việc vào 1 tin nhắc
        batch = items_to_remind[:3]

        # Đánh dấu đã nhắc hôm nay
        for it in batch:
            ZaloReminderHistory.objects.create(
                user=user,
                work_item_id=it.id,
                reminder_date=today,
            )

        # Lưu index map để người dùng có thể gõ ngay `dời 1` hay `xong 1`
        _save_task_index_map(user, link.chat_id, batch)

        if len(batch) == 1:
            it = batch[0]
            date_label = "hôm nay" if it.work_date == today else f"quá hạn {it.work_date.strftime('%d/%m')}"
            text = (
                f"⏰ Nhắc việc: Việc \"{it.title}\" ({date_label}) chưa thấy xử lý.\n\n"
                "👉 Trả lời `dời 1` để dời sang ngày mai, hoặc `xong 1` nếu đã xong."
            )
        else:
            lines = ["⏰ Nhắc việc: Bạn có các công việc chưa xử lý:"]
            for idx, it in enumerate(batch, 1):
                date_label = "hôm nay" if it.work_date == today else f"quá hạn {it.work_date.strftime('%d/%m')}"
                lines.append(f"{idx}. \"{it.title}\" ({date_label})")
            lines.append("\n👉 Trả lời `dời <số>` để dời sang ngày mai, hoặc `xong <số>` nếu đã xong.")
            text = "\n".join(lines)

        res = client.send_message(link.chat_id, text)
        is_ok = bool(res.get("ok", False))

        ZaloSendLog.objects.create(
            user=user,
            chat_id=link.chat_id,
            category="work_reminder",
            status=ZaloSendLog.STATUS_SENT if is_ok else ZaloSendLog.STATUS_FAILED,
            error_message="" if is_ok else str(res.get("error", "Reminder send failed"))[:255],
        )

        if is_ok:
            total_reminded += len(batch)

    return {
        "total_links": len(active_links),
        "total_reminded": total_reminded,
        "skipped_quiet": skipped_quiet,
        "skipped_cap": skipped_cap,
    }
