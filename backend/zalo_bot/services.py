import hashlib
import logging
import re
import secrets
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from authentication.models import UserProfile
from gmail_assistant.models import MailDigest
from work_schedule.models import WorkItem
from work_schedule.views import _detach_from_sheet_row, sync_training_from_work_item

from .client import ZaloBotClient
from .models import (
    ZaloInboundEvent,
    ZaloLink,
    ZaloLinkCode,
    ZaloPendingAction,
    ZaloReminderHistory,
    ZaloSendLog,
)

logger = logging.getLogger(__name__)


def hash_link_code(code: str) -> str:
    """Băm SHA-256 mã liên kết để lưu an toàn trong cơ sở dữ liệu."""
    return hashlib.sha256(str(code).strip().encode("utf-8")).hexdigest()


def generate_link_code(user: UserProfile) -> dict:
    """
    Sinh mã liên kết 6 chữ số dùng 1 lần, có hiệu lực 10 phút.
    Vô hiệu hóa các mã cũ chưa dùng của người dùng này.
    """
    now = timezone.now()
    # Vô hiệu hóa các mã chưa dùng trước đó của user
    ZaloLinkCode.objects.filter(user=user, is_used=False).update(is_used=True)

    # Sinh mã 6 chữ số ngẫu nhiên
    raw_code = f"{secrets.randbelow(900000) + 100000}"
    code_h = hash_link_code(raw_code)
    expires_at = now + timedelta(minutes=10)

    ZaloLinkCode.objects.create(
        user=user,
        code_hash=code_h,
        expires_at=expires_at,
        is_used=False,
    )

    return {
        "code": raw_code,
        "expires_at": expires_at.isoformat(),
        "expires_in_seconds": 600,
    }


def verify_and_link(chat_id: str, raw_code: str, zalo_user_id: str = "") -> tuple[bool, str]:
    """
    Xác thực mã và liên kết chat_id với tài khoản Workspace.
    Đảm bảo quan hệ 1-1 chặt chẽ giữa UserProfile và Zalo Chat ID.
    """
    chat_id_str = str(chat_id).strip()
    code_str = str(raw_code).strip()
    now = timezone.now()

    # Kiểm tra xem chat_id này đã được liên kết với ai chưa
    existing_link = ZaloLink.objects.filter(chat_id=chat_id_str).select_related("user").first()
    if existing_link:
        return (
            False,
            f"Tài khoản Zalo này đã được liên kết với ({existing_link.user.email}). "
            "Nếu muốn đổi tài khoản, vui lòng nhắn 'hủy liên kết' trước.",
        )

    code_h = hash_link_code(code_str)
    link_code = (
        ZaloLinkCode.objects.filter(
            code_hash=code_h,
            is_used=False,
            expires_at__gt=now,
        )
        .select_related("user")
        .first()
    )

    if not link_code:
        # Kiểm tra chống brute-force nếu có code cũ trùng nhưng sai hạn
        failed_entry = ZaloLinkCode.objects.filter(code_hash=code_h).first()
        if failed_entry:
            failed_entry.failed_attempts += 1
            failed_entry.save(update_fields=["failed_attempts"])
        return (
            False,
            "Mã liên kết không đúng hoặc đã hết hạn (hiệu lực 10 phút). "
            "Vui lòng tạo mã mới trong phần Cài đặt tài khoản trên workspace.",
        )

    user = link_code.user

    # Đánh dấu mã đã dùng
    link_code.is_used = True
    link_code.save(update_fields=["is_used"])

    # Nếu user này trước đó đã liên kết với một chat_id khác, xóa liên kết cũ
    ZaloLink.objects.filter(user=user).delete()

    # Tạo liên kết mới
    ZaloLink.objects.create(
        user=user,
        chat_id=chat_id_str,
        zalo_user_id=str(zalo_user_id).strip(),
        is_enabled=True,
    )

    client = ZaloBotClient()
    display_user_name = getattr(user, "name", "") or getattr(user, "displayName", "") or user.email
    welcome_text = (
        f"Xin chào {display_user_name}!\n"
        "Bạn đã liên kết tài khoản Fermat Workspace thành công.\n\n"
        "Các câu lệnh bạn có thể nhắn:\n"
        "- việc hôm nay : Xem danh sách việc hôm nay\n"
        "- việc ngày mai : Xem danh sách việc ngày mai\n"
        "- thư mới : Xem email cần phản hồi\n"
        "- trợ giúp : Danh sách câu lệnh đầy đủ"
    )
    client.send_message(chat_id_str, welcome_text)

    # Ghi log không kèm nội dung
    ZaloSendLog.objects.create(
        user=user,
        chat_id=chat_id_str,
        category="system",
        status=ZaloSendLog.STATUS_SENT,
    )

    return True, f"Liên kết thành công với tài khoản {user.email}."


def unlink_user(user: UserProfile) -> bool:
    """
    Hủy liên kết Zalo của người dùng.
    Dọn dẹp: ZaloLink, ZaloPendingAction, ZaloSendLog, ZaloReminderHistory của chính người đó.
    """
    link = ZaloLink.objects.filter(user=user).first()
    if link:
        client = ZaloBotClient()
        goodbye_text = (
            "Tài khoản Zalo của bạn đã được hủy liên kết khỏi Fermat Workspace. "
            "Bạn sẽ không còn nhận được thông báo từ hệ thống nữa."
        )
        client.send_message(link.chat_id, goodbye_text)
        link.delete()

    ZaloPendingAction.objects.filter(user=user).delete()
    ZaloSendLog.objects.filter(user=user).delete()
    ZaloReminderHistory.objects.filter(user=user).delete()
    return True


def is_in_quiet_hours(link: ZaloLink, check_dt=None) -> bool:
    """Kiểm tra thời điểm hiện tại có rơi vào khung giờ yên lặng của người dùng không."""
    if not link.quiet_hours_enabled:
        return False

    now_local = timezone.localtime(check_dt or timezone.now())
    current_t = now_local.time()
    start_t = link.quiet_hours_start or time(22, 0)
    end_t = link.quiet_hours_end or time(7, 0)

    if start_t <= end_t:
        return start_t <= current_t <= end_t
    else:
        # Khung giờ vắt qua nửa đêm (ví dụ 22:00 -> 07:00)
        return current_t >= start_t or current_t <= end_t


def check_send_limits(user: UserProfile, category: str, now=None) -> tuple[bool, str]:
    """
    Kiểm tra hạn mức tin nhắn:
    1. Giới hạn ngày của user (daily_cap)
    2. Giới hạn tháng toàn hệ thống (ZALO_BOT_MONTHLY_CAP, mặc định 2500)
       - Nếu vượt 80% cap: chỉ gửi loại quan trọng (urgent, work_reminder, command_reply, test)
       - Nếu vượt 100% cap: chỉ cho phép command_reply
    """
    now = now or timezone.now()
    now_local = timezone.localtime(now)

    # 1. User daily cap
    link = getattr(user, "zalo_link", None)
    daily_cap = getattr(link, "daily_cap", 50) if link else 50
    user_sent_today = ZaloSendLog.objects.filter(
        user=user,
        sent_at__date=now_local.date(),
        status=ZaloSendLog.STATUS_SENT,
    ).count()

    if user_sent_today >= daily_cap:
        return False, f"Vượt trần tin nhắn trong ngày của người dùng ({user_sent_today}/{daily_cap})"

    # 2. System monthly cap
    monthly_cap = getattr(settings, "ZALO_BOT_MONTHLY_CAP", 2500)
    system_sent_month = ZaloSendLog.objects.filter(
        sent_at__year=now_local.year,
        sent_at__month=now_local.month,
        status=ZaloSendLog.STATUS_SENT,
    ).count()

    critical_categories = {"urgent", "work_reminder", "command_reply", "test"}

    if system_sent_month >= monthly_cap:
        if category != "command_reply":
            return False, f"Hệ thống đã đạt trần tin nhắn Zalo tháng ({system_sent_month}/{monthly_cap})"
    elif system_sent_month >= int(monthly_cap * 0.8):
        if category not in critical_categories:
            return False, f"Hệ thống đạt mức cảnh báo 80% ({system_sent_month}/{monthly_cap}), tạm hoãn tin phụ"

    return True, ""


def send_user_notification(
    user: UserProfile,
    title: str,
    message: str,
    category: str,
    action_url: str = "",
    force: bool = False,
) -> bool:
    """
    Gửi thông báo tới Zalo của người dùng tuân thủ cài đặt cá nhân:
    - Bật/tắt chung
    - Bật/tắt theo category
    - Khung giờ yên lặng
    - Trần tin nhắn
    - Mức độ chi tiết (title vs summary)
    """
    try:
        link = ZaloLink.objects.filter(user=user).first()
    except Exception:
        return False

    if not link or not link.is_enabled:
        return False

    # Kiểm tra loại thông báo
    cat_lower = str(category).lower()
    if "schedule" in cat_lower and not link.notify_schedule:
        return False
    elif "gmail" in cat_lower and not link.notify_gmail:
        return False
    elif "weekly" in cat_lower and not link.notify_weekly_report:
        return False
    elif not ("schedule" in cat_lower or "gmail" in cat_lower or "weekly" in cat_lower):
        if not link.notify_workspace:
            return False

    # Kiểm tra giờ yên lặng & hạn mức (nếu không force)
    if not force:
        if is_in_quiet_hours(link):
            ZaloSendLog.objects.create(
                user=user,
                chat_id=link.chat_id,
                category=category,
                status=ZaloSendLog.STATUS_SKIPPED,
                error_message="Quiet hours active",
            )
            return False

        allowed, reason = check_send_limits(user, category)
        if not allowed:
            ZaloSendLog.objects.create(
                user=user,
                chat_id=link.chat_id,
                category=category,
                status=ZaloSendLog.STATUS_SKIPPED,
                error_message=reason[:255],
            )
            return False

    # Định dạng tin nhắn: Mặc định chỉ tiêu đề + link
    url_part = f"\n👉 Mở workspace: {action_url}" if action_url else ""
    if link.detail_level == ZaloLink.DETAIL_SUMMARY and message:
        clean_msg = message.strip()
        text = f"🔔 {title}\n\n{clean_msg}{url_part}"
    else:
        text = f"🔔 {title}{url_part}"

    client = ZaloBotClient()
    res = client.send_message(link.chat_id, text)
    is_ok = bool(res.get("ok", False))

    ZaloSendLog.objects.create(
        user=user,
        chat_id=link.chat_id,
        category=category,
        status=ZaloSendLog.STATUS_SENT if is_ok else ZaloSendLog.STATUS_FAILED,
        error_message="" if is_ok else str(res.get("error", "Send failed"))[:255],
    )
    return is_ok


def dispatch_workspace_notification_to_zalo(notification, recipient_profiles):
    """
    Chuyển phát WorkspaceNotification mới tới các tài khoản Zalo hợp lệ.
    """
    for profile in recipient_profiles:
        try:
            send_user_notification(
                user=profile,
                title=notification.title,
                message=notification.message,
                category=notification.category or "workspace",
                action_url=notification.action_url or "",
            )
        except Exception as e:
            logger.error("Failed to dispatch Zalo notification to %s: %s", profile.email, str(e))


def _save_task_index_map(user: UserProfile, chat_id: str, items: list) -> None:
    """Lưu mapping danh sách số thứ tự (1, 2, 3...) sang WorkItem id cho user."""
    ZaloPendingAction.objects.filter(user=user, action_type="task_index_map").delete()
    item_ids = [item.id for item in items]
    ZaloPendingAction.objects.create(
        user=user,
        chat_id=chat_id,
        action_type="task_index_map",
        payload={"item_ids": item_ids},
        expires_at=timezone.now() + timedelta(hours=12),
    )


def _get_item_by_number(user: UserProfile, number_str: str) -> tuple[WorkItem | None, str]:
    """Tìm WorkItem theo số thứ tự hiển thị gần nhất của user."""
    try:
        num = int(number_str)
        if num < 1:
            return None, "Số thứ tự không hợp lệ (phải từ 1 trở lên)."
    except ValueError:
        return None, "Số thứ tự phải là số nguyên."

    # Ưu tiên lấy từ mapping gần nhất của user
    map_action = (
        ZaloPendingAction.objects.filter(
            user=user,
            action_type="task_index_map",
            expires_at__gt=timezone.now(),
        )
        .order_by("-created_at")
        .first()
    )

    if map_action and "item_ids" in map_action.payload:
        item_ids = map_action.payload["item_ids"]
        if 1 <= num <= len(item_ids):
            item_id = item_ids[num - 1]
            item = WorkItem.objects.filter(id=item_id, executor=user).first()
            if item:
                return item, ""

    # Dự phòng: tìm từ danh sách việc hôm nay hoặc quá hạn của chính user
    today = timezone.localdate()
    items = list(
        WorkItem.objects.filter(
            executor=user,
            work_date__lte=today,
            status__in=[WorkItem.STATUS_TODO, WorkItem.STATUS_DOING],
        ).order_by("work_date", "daily_order", "start_time")
    )

    if 1 <= num <= len(items):
        return items[num - 1], ""

    return None, f"Không tìm thấy công việc số {num} trong danh sách của bạn."


def handle_inbound_message(chat_id: str, text: str, from_user: dict = None) -> str:
    """
    Xử lý tin nhắn văn bản gửi tới bot:
    1. Kiểm tra liên kết
    2. Nếu chưa liên kết: chỉ hỗ trợ nhập mã 6 số
    3. Nếu đã liên kết: xử lý danh sách lệnh cố định (QUY TẮC: chỉ thao tác dữ liệu của chính user)
    """
    chat_id_str = str(chat_id).strip()
    raw_text = (text or "").strip()
    if not raw_text:
        return ""

    client = ZaloBotClient()

    # 1. Kiểm tra liên kết
    link = ZaloLink.objects.filter(chat_id=chat_id_str).select_related("user").first()

    if not link:
        # Nếu chưa liên kết: kiểm tra xem có phải mã 6 số không
        m = re.match(r"^\s*(\d{6})\s*$", raw_text)
        if m:
            success, msg = verify_and_link(
                chat_id=chat_id_str,
                raw_code=m.group(1),
                zalo_user_id=str(from_user.get("id", "")) if from_user else "",
            )
            return msg

        reply = (
            "Chào bạn! Tài khoản Zalo này chưa được liên kết với Fermat Workspace.\n\n"
            "Để liên kết:\n"
            "1. Đăng nhập Fermat Workspace trên trình duyệt\n"
            "2. Vào Hồ sơ -> Thẻ 'Zalo' -> Lấy mã liên kết 6 chữ số\n"
            "3. Nhắn mã 6 chữ số đó vào đây."
        )
        client.send_message(chat_id_str, reply)
        return reply

    # 2. Người dùng đã liên kết
    user = link.user
    norm_text = raw_text.lower().strip()

    # Log command interaction (không lưu text)
    ZaloSendLog.objects.create(
        user=user,
        chat_id=chat_id_str,
        category="command_reply",
        status=ZaloSendLog.STATUS_SENT,
    )

    # --- LỆNH: VIỆC HÔM NAY ---
    if norm_text in ["việc hôm nay", "viec hom nay", "hôm nay", "hom nay"]:
        today = timezone.localdate()
        items = list(
            WorkItem.objects.filter(
                executor=user,
                work_date=today,
            ).order_by("daily_order", "start_time")
        )

        if not items:
            reply = f"📋 Lịch hôm nay ({today.strftime('%d/%m/%Y')}):\nBạn không có công việc nào trên lịch."
        else:
            _save_task_index_map(user, chat_id_str, items)
            lines = [f"📋 Việc hôm nay ({today.strftime('%d/%m/%Y')}):"]
            for idx, it in enumerate(items, 1):
                status_icon = "✅" if it.status == WorkItem.STATUS_COMPLETED else "⏳"
                time_part = f"[{it.start_time.strftime('%H:%M')}] " if it.start_time else ""
                lines.append(f"{idx}. {status_icon} {time_part}{it.title}")
            lines.append("\n👉 Nhắn `xong <số>` để hoàn thành, hoặc `dời <số> sang mai` để dời lịch.")
            reply = "\n".join(lines)

        client.send_message(chat_id_str, reply)
        return reply

    # --- LỆNH: VIỆC NGÀY MAI ---
    if norm_text in ["việc ngày mai", "viec ngay mai", "ngày mai", "ngay mai"]:
        tomorrow = timezone.localdate() + timedelta(days=1)
        items = list(
            WorkItem.objects.filter(
                executor=user,
                work_date=tomorrow,
            ).order_by("daily_order", "start_time")
        )

        if not items:
            reply = f"📋 Lịch ngày mai ({tomorrow.strftime('%d/%m/%Y')}):\nBạn chưa có công việc nào."
        else:
            _save_task_index_map(user, chat_id_str, items)
            lines = [f"📋 Việc ngày mai ({tomorrow.strftime('%d/%m/%Y')}):"]
            for idx, it in enumerate(items, 1):
                status_icon = "✅" if it.status == WorkItem.STATUS_COMPLETED else "⏳"
                time_part = f"[{it.start_time.strftime('%H:%M')}] " if it.start_time else ""
                lines.append(f"{idx}. {status_icon} {time_part}{it.title}")
            reply = "\n".join(lines)

        client.send_message(chat_id_str, reply)
        return reply

    # --- LỆNH: XONG <SỐ> ---
    m_done = re.match(r"^xong\s*(\d+)$", norm_text)
    if m_done:
        num_str = m_done.group(1)
        item, err = _get_item_by_number(user, num_str)
        if err:
            client.send_message(chat_id_str, f"⚠️ {err}")
            return err

        item.status = WorkItem.STATUS_COMPLETED
        item.save(update_fields=["status", "updated_at"])
        sync_training_from_work_item(item)

        reply = f"✅ Đã đánh dấu hoàn thành: {item.title}"
        client.send_message(chat_id_str, reply)
        return reply

    # --- LỆNH: DỜI <SỐ> [SANG MAI | DD/MM] ---
    m_move = re.match(
        r"^(?:dời|doi)\s*(\d+)(?:\s+(?:sang\s*mai|sang\s*ngay\s*mai|mai|(\d{1,2})[/-](\d{1,2})))?$",
        norm_text,
    )
    if m_move:
        num_str = m_move.group(1)
        item, err = _get_item_by_number(user, num_str)
        if err:
            client.send_message(chat_id_str, f"⚠️ {err}")
            return err

        today = timezone.localdate()
        target_date = today + timedelta(days=1)  # Mặc định sang mai

        day_part = m_move.group(2)
        month_part = m_move.group(3)
        if day_part and month_part:
            try:
                target_date = datetime(today.year, int(month_part), int(day_part)).date()
                if target_date < today:
                    target_date = datetime(today.year + 1, int(month_part), int(day_part)).date()
            except ValueError:
                reply = "⚠️ Ngày đích không hợp lệ. Vui lòng thử lại theo định dạng dd/mm (ví dụ: `dời 1 15/11`)."
                client.send_message(chat_id_str, reply)
                return reply

        target_date_str = target_date.strftime("%d/%m/%Y")
        # QUY TẮC: Ghi dữ liệu trừ 'xong' cần xác nhận ok/có
        ZaloPendingAction.objects.filter(user=user, action_type="reschedule_work_item").delete()
        ZaloPendingAction.objects.create(
            user=user,
            chat_id=chat_id_str,
            action_type="reschedule_work_item",
            payload={
                "work_item_id": item.id,
                "target_date": target_date.isoformat(),
                "title": item.title,
            },
            prompt_message=f"Dời việc '{item.title}' sang ngày {target_date_str}",
            expires_at=timezone.now() + timedelta(hours=12),
        )

        reply = (
            f"Bạn có muốn dời việc:\n\"{item.title}\"\nsang ngày {target_date_str}?\n\n"
            "👉 Nhắn `ok` hoặc `có` để xác nhận, `hủy` để bỏ qua."
        )
        client.send_message(chat_id_str, reply)
        return reply

    # --- LỆNH: XÁC NHẬN (OK / CÓ) ---
    if norm_text in ["ok", "có", "co", "đồng ý", "dong y", "xác nhận", "xac nhan"]:
        action = (
            ZaloPendingAction.objects.filter(
                user=user,
                expires_at__gt=timezone.now(),
            )
            .exclude(action_type="task_index_map")
            .order_by("-created_at")
            .first()
        )

        if not action:
            reply = "Hiện không có thao tác nào đang chờ xác nhận."
            client.send_message(chat_id_str, reply)
            return reply

        if action.action_type == "reschedule_work_item":
            item_id = action.payload.get("work_item_id")
            target_date_iso = action.payload.get("target_date")
            item = WorkItem.objects.filter(id=item_id, executor=user).first()
            if not item:
                reply = "⚠️ Không tìm thấy công việc này hoặc bạn không còn là người thực hiện."
            else:
                target_d = datetime.fromisoformat(target_date_iso).date()
                _detach_from_sheet_row(item)
                item.work_date = target_d
                max_order = (
                    WorkItem.objects.filter(executor=user, work_date=target_d).aggregate(
                        models.Max("daily_order")
                    )["daily_order__max"]
                    or 0
                )
                item.daily_order = max_order + 1
                item.save(
                    update_fields=[
                        "work_date",
                        "daily_order",
                        "source_sheet_row",
                        "source_task_index",
                        "updated_at",
                    ]
                )
                sync_training_from_work_item(item)
                reply = f"✅ Đã dời việc \"{item.title}\" sang ngày {target_d.strftime('%d/%m/%Y')}."

            action.delete()
            client.send_message(chat_id_str, reply)
            return reply

        elif action.action_type == "unlink":
            action.delete()
            unlink_user(user)
            return "Đã hủy liên kết Zalo."

    # --- LỆNH: HỦY (BỎ QUA) ---
    if norm_text in ["hủy", "huy", "bỏ qua", "bo qua", "không", "khong"]:
        deleted_count, _ = (
            ZaloPendingAction.objects.filter(user=user)
            .exclude(action_type="task_index_map")
            .delete()
        )
        reply = "Đã hủy thao tác đang chờ." if deleted_count > 0 else "Không có thao tác nào cần hủy."
        client.send_message(chat_id_str, reply)
        return reply

    # --- LỆNH: THƯ MỚI ---
    if norm_text in ["thư mới", "thu moi", "email", "mail"]:
        # QUY TẮC: Chỉ lấy digest của chính user
        digests = list(
            MailDigest.objects.filter(
                user=user,
                status=MailDigest.STATUS_NEW,
            ).order_by("-received_at")[:5]
        )

        if not digests:
            reply = "📬 Hộp thư của bạn không có email mới nào cần xử lý."
        else:
            lines = [f"📬 Thư mới cần chú ý ({len(digests)} thư gần nhất):"]
            for idx, d in enumerate(digests, 1):
                sender_name = d.sender.split("<")[0].strip() or d.sender
                reply_part = f" (Hạn: {d.reply_by})" if d.reply_by else ""
                lines.append(f"{idx}. Từ: {sender_name}")
                lines.append(f"   Tiêu đề: {d.subject}{reply_part}")
                if d.actions and isinstance(d.actions, list):
                    first_action = d.actions[0]
                    if isinstance(first_action, dict):
                        action_text = first_action.get("task") or first_action.get("action", "")
                    else:
                        action_text = str(first_action)
                    if action_text:
                        lines.append(f"   👉 Việc: {action_text}")
            lines.append("\n👉 Mở workspace để xem chi tiết và phản hồi.")
            reply = "\n".join(lines)

        client.send_message(chat_id_str, reply)
        return reply

    # --- LỆNH: TẮT / BẬT THÔNG BÁO ---
    if norm_text in ["tắt thông báo", "tat thong bao", "tat thong bao zalo"]:
        link.is_enabled = False
        link.save(update_fields=["is_enabled", "updated_at"])
        reply = "🔕 Đã tạm dừng nhận thông báo qua Zalo. Bạn có thể nhắn `bật thông báo` bất cứ lúc nào để nhận lại."
        client.send_message(chat_id_str, reply)
        return reply

    if norm_text in ["bật thông báo", "bat thong bao", "bat thong bao zalo"]:
        link.is_enabled = True
        link.save(update_fields=["is_enabled", "updated_at"])
        reply = "🔔 Đã bật lại thông báo qua Zalo cho tài khoản của bạn."
        client.send_message(chat_id_str, reply)
        return reply

    # --- LỆNH: HỦY LIÊN KẾT ---
    if norm_text in ["hủy liên kết", "huy lien ket"]:
        ZaloPendingAction.objects.filter(user=user, action_type="unlink").delete()
        ZaloPendingAction.objects.create(
            user=user,
            chat_id=chat_id_str,
            action_type="unlink",
            prompt_message="Hủy liên kết Zalo khỏi tài khoản Workspace",
            expires_at=timezone.now() + timedelta(hours=1),
        )
        reply = (
            f"Bạn có chắc chắn muốn hủy liên kết Zalo với tài khoản ({user.email})?\n\n"
            "👉 Nhắn `ok` hoặc `có` để xác nhận hủy, nhắn `hủy` để giữ lại."
        )
        client.send_message(chat_id_str, reply)
        return reply

    # --- LỆNH: TRỢ GIÚP ---
    if norm_text in ["trợ giúp", "tro giup", "help", "?", "huong dan"]:
        reply = (
            "📌 DANH SÁCH CÂU LỆNH:\n\n"
            "- `việc hôm nay`: Xem danh sách công việc hôm nay\n"
            "- `việc ngày mai`: Xem danh sách công việc ngày mai\n"
            "- `xong <số>`: Đánh dấu việc đã hoàn thành (VD: `xong 1`)\n"
            "- `dời <số> sang mai`: Dời việc sang ngày mai (VD: `dời 1 sang mai`)\n"
            "- `dời <số> dd/mm`: Dời việc sang ngày cụ thể (VD: `dời 1 15/11`)\n"
            "- `thư mới`: Xem các email mới cần phản hồi\n"
            "- `tắt thông báo`: Tạm dừng nhận thông báo Zalo\n"
            "- `bật thông báo`: Tiếp tục nhận thông báo Zalo\n"
            "- `hủy liên kết`: Hủy liên kết Zalo với tài khoản workspace\n"
            "- `trợ giúp`: Xem bảng hướng dẫn này"
        )
        client.send_message(chat_id_str, reply)
        return reply

    # Lệnh lạ / không nhận diện được
    reply = (
        "Bot chưa hiểu câu lệnh này. "
        "Hãy nhắn `trợ giúp` để xem danh sách câu lệnh hỗ trợ."
    )
    client.send_message(chat_id_str, reply)
    return reply
