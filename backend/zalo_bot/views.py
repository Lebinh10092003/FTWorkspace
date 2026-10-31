import hmac
import json
import logging
from datetime import datetime, time

from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.permissions import IsWorkspaceAuthenticated

from .client import ZaloBotClient
from .models import ZaloInboundEvent, ZaloLink, ZaloSendLog
from .services import (
    generate_link_code,
    handle_inbound_message,
    send_user_notification,
    unlink_user,
)

logger = logging.getLogger(__name__)


def mask_chat_id(chat_id: str) -> str:
    """Che giấu bớt chat_id để bảo mật trên giao diện (ví dụ: 123***789)."""
    s = str(chat_id).strip()
    if len(s) <= 4:
        return s
    return f"{s[:3]}***{s[-3:]}"


@csrf_exempt
def webhook_view(request):
    """
    Webhook tiếp nhận sự kiện từ Zalo Bot Platform (hoặc reverse proxy).
    Quy tắc:
    - Miễn CSRF
    - Xác thực header X-Bot-Api-Secret-Token bằng hmac.compare_digest
    - Xử lý idempotent theo message_id / update_id
    - Trả HTTP 200 nhanh chóng, không throw exception ra ngoài
    """
    if request.method == "GET":
        return JsonResponse({"ok": True, "service": "zalo_bot_webhook"})

    if request.method != "POST":
        return JsonResponse({"ok": False, "error": "Method not allowed"}, status=405)

    # 1. Xác thực Secret Token
    # Chưa cấu hình secret thì TỪ CHỐI mọi yêu cầu (không để webhook mở, tránh giả danh người dùng).
    configured_secret = getattr(settings, "ZALO_BOT_WEBHOOK_SECRET", "")
    if not configured_secret:
        logger.warning("ZaloBot webhook: ZALO_BOT_WEBHOOK_SECRET chưa cấu hình, từ chối yêu cầu.")
        return JsonResponse({"ok": False, "error": "Webhook not configured"}, status=403)
    header_secret = request.headers.get("X-Bot-Api-Secret-Token", "")
    if not hmac.compare_digest(str(header_secret), str(configured_secret)):
        logger.warning("ZaloBot webhook: Invalid secret token received.")
        return JsonResponse({"ok": False, "error": "Invalid secret token"}, status=403)

    # 2. Phân tích nội dung JSON
    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except Exception as e:
        logger.error("ZaloBot webhook: JSON parse error: %s", str(e))
        return JsonResponse({"ok": False, "error": "Invalid JSON"}, status=400)

    try:
        # Hỗ trợ cấu trúc Telegram-like Update object
        message = data.get("message") or data.get("edited_message") or {}
        update_id = data.get("update_id")

        if not message and not update_id:
            return JsonResponse({"ok": True, "note": "No message in update"})

        msg_id = str(message.get("message_id") or update_id or "")
        chat = message.get("chat") or {}
        chat_id = str(chat.get("id") or message.get("from", {}).get("id") or "")
        text = str(message.get("text") or "").strip()
        from_user = message.get("from") or {}

        if not chat_id:
            return JsonResponse({"ok": True, "note": "Missing chat_id"})

        # 3. Idempotency check: Tránh xử lý sự kiện trùng lặp
        if msg_id:
            if ZaloInboundEvent.objects.filter(message_id=msg_id).exists():
                return JsonResponse({"ok": True, "note": "Already processed"})
            ZaloInboundEvent.objects.create(message_id=msg_id, chat_id=chat_id)

        # 4. Xử lý tin nhắn
        if text:
            handle_inbound_message(chat_id=chat_id, text=text, from_user=from_user)

    except Exception as e:
        logger.exception("ZaloBot webhook processing error: %s", str(e))
        # Luôn trả 200 để platform không retry dồn dập
        return JsonResponse({"ok": True, "error_handled": True})

    return JsonResponse({"ok": True})


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def user_status_view(request):
    """Lấy trạng thái liên kết Zalo và cấu hình cá nhân của người dùng hiện tại."""
    user = request.user
    link = ZaloLink.objects.filter(user=user).first()

    now = timezone.localtime(timezone.now())
    monthly_cap = getattr(settings, "ZALO_BOT_MONTHLY_CAP", 2500)
    system_sent_month = ZaloSendLog.objects.filter(
        sent_at__year=now.year,
        sent_at__month=now.month,
        status=ZaloSendLog.STATUS_SENT,
    ).count()

    if not link:
        return Response({
            "success": True,
            "linked": False,
            "monthly_system_usage": {
                "sent": system_sent_month,
                "cap": monthly_cap,
            },
        })

    return Response({
        "success": True,
        "linked": True,
        "chat_id_masked": mask_chat_id(link.chat_id),
        "linked_at": link.linked_at.isoformat() if link.linked_at else None,
        "is_enabled": link.is_enabled,
        "detail_level": link.detail_level,
        "notify_schedule": link.notify_schedule,
        "notify_gmail": link.notify_gmail,
        "notify_weekly_report": link.notify_weekly_report,
        "notify_workspace": link.notify_workspace,
        "quiet_hours_enabled": link.quiet_hours_enabled,
        "quiet_hours_start": link.quiet_hours_start.strftime("%H:%M") if link.quiet_hours_start else "22:00",
        "quiet_hours_end": link.quiet_hours_end.strftime("%H:%M") if link.quiet_hours_end else "07:00",
        "daily_cap": link.daily_cap,
        "monthly_system_usage": {
            "sent": system_sent_month,
            "cap": monthly_cap,
        },
    })


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def generate_link_code_view(request):
    """Tạo mã liên kết Zalo 6 chữ số (hiệu lực 10 phút) cho người dùng hiện tại."""
    code_info = generate_link_code(request.user)
    return Response({
        "success": True,
        "code": code_info["code"],
        "expires_at": code_info["expires_at"],
        "expires_in_seconds": code_info["expires_in_seconds"],
    })


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def update_preferences_view(request):
    """Cập nhật cài đặt nhận thông báo Zalo của người dùng."""
    user = request.user
    link = ZaloLink.objects.filter(user=user).first()
    if not link:
        return Response({"success": False, "error": "Tài khoản chưa liên kết Zalo."}, status=status.HTTP_400_BAD_REQUEST)

    data = request.data or {}

    if "is_enabled" in data:
        link.is_enabled = bool(data["is_enabled"])
    if "detail_level" in data and data["detail_level"] in [ZaloLink.DETAIL_TITLE, ZaloLink.DETAIL_SUMMARY]:
        link.detail_level = data["detail_level"]
    if "notify_schedule" in data:
        link.notify_schedule = bool(data["notify_schedule"])
    if "notify_gmail" in data:
        link.notify_gmail = bool(data["notify_gmail"])
    if "notify_weekly_report" in data:
        link.notify_weekly_report = bool(data["notify_weekly_report"])
    if "notify_workspace" in data:
        link.notify_workspace = bool(data["notify_workspace"])
    if "quiet_hours_enabled" in data:
        link.quiet_hours_enabled = bool(data["quiet_hours_enabled"])

    if "quiet_hours_start" in data:
        try:
            parts = [int(p) for p in str(data["quiet_hours_start"]).split(":")]
            link.quiet_hours_start = time(parts[0], parts[1])
        except Exception:
            pass

    if "quiet_hours_end" in data:
        try:
            parts = [int(p) for p in str(data["quiet_hours_end"]).split(":")]
            link.quiet_hours_end = time(parts[0], parts[1])
        except Exception:
            pass

    link.save()
    return Response({"success": True, "message": "Đã lưu cài đặt thông báo Zalo."})


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def test_send_view(request):
    """Gửi một tin nhắn thử nghiệm tới tài khoản Zalo của người dùng."""
    user = request.user
    link = ZaloLink.objects.filter(user=user).first()
    if not link:
        return Response({"success": False, "error": "Bạn chưa liên kết tài khoản Zalo."}, status=status.HTTP_400_BAD_REQUEST)

    ok = send_user_notification(
        user=user,
        title="Kiểm tra kết nối Zalo Bot thành công",
        message="Đây là thông báo thử nghiệm từ hệ thống Fermat Workspace. Bạn đã cấu hình nhận thông báo thành công!",
        category="test",
        action_url="",
        force=True,  # Bỏ qua quiet hours khi người dùng chủ động thử
    )

    if ok:
        return Response({"success": True, "message": "Đã gửi tin nhắn thử nghiệm tới Zalo của bạn."})
    return Response({"success": False, "error": "Không thể gửi tin nhắn thử nghiệm. Vui lòng thử lại sau."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def unlink_view(request):
    """Hủy liên kết tài khoản Zalo của người dùng hiện tại."""
    user = request.user
    unlink_user(user)
    return Response({"success": True, "message": "Đã hủy liên kết Zalo thành công."})
