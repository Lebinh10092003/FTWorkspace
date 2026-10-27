"""API Views for Workspace Assistant Chatbot."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Dict

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.permissions import IsWorkspaceAuthenticated
from documents.models import AiServiceHealth

from .models import AiChatJob, ChatAction, ChatMessage, ChatSession
from .service import (
    cancel_chat_job,
    check_daily_rate_limit,
    get_chat_queue_position,
)
from .tools_allowlist import execute_tool_safely

logger = logging.getLogger(__name__)

MAX_USER_MESSAGE_CHARS = 2000
HISTORY_RETENTION_DAYS = 30


def _cleanup_old_history(user):
    """Clean up user messages older than 30 days."""
    cutoff = timezone.now() - timedelta(days=HISTORY_RETENTION_DAYS)
    ChatMessage.objects.filter(user=user, created_at__lt=cutoff).delete()


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def chat_history(request):
    """Retrieve full conversation history for the current authenticated user only."""
    user = request.user
    _cleanup_old_history(user)

    session = ChatSession.objects.filter(user=user).order_by("-updated_at").first()
    if not session:
        return Response({"messages": []})

    messages_qs = ChatMessage.objects.filter(session=session, user=user).order_by("created_at")

    # Fetch any relevant pending actions
    action_ids = set()
    for m in messages_qs:
        for aid in m.action_ids or []:
            action_ids.add(aid)

    actions_by_id = {}
    if action_ids:
        actions = ChatAction.objects.filter(id__in=action_ids, user=user)
        for a in actions:
            a.check_and_expire()
            actions_by_id[str(a.id)] = {
                "id": str(a.id),
                "tool_name": a.tool_name,
                "preview_description": a.preview_description,
                "diff_summary": a.diff_summary,
                "status": a.status,
                "expires_at": a.expires_at.isoformat(),
                "error_message": a.error_message,
            }

    serialized = []
    for m in messages_qs:
        msg_actions = [actions_by_id[aid] for aid in (m.action_ids or []) if aid in actions_by_id]
        serialized.append({
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "links": m.links or [],
            "actions": msg_actions,
            "created_at": m.created_at.isoformat(),
        })

    return Response({"messages": serialized})


@api_view(["DELETE"])
@permission_classes([IsWorkspaceAuthenticated])
def clear_chat_history(request):
    """Clear conversation history for the current authenticated user."""
    user = request.user
    ChatMessage.objects.filter(user=user).delete()
    ChatSession.objects.filter(user=user).delete()
    ChatAction.objects.filter(user=user).delete()
    return Response({"success": True, "message": "Đã xóa toàn bộ lịch sử trò chuyện."})


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def send_chat_message(request):
    """Submit a new message from the user and enqueue an AI Chat job."""
    user = request.user
    content = str(request.data.get("message") or "").strip()

    if not content:
        return Response({"error": "Vui lòng nhập nội dung tin nhắn."}, status=status.HTTP_400_BAD_REQUEST)

    if len(content) > MAX_USER_MESSAGE_CHARS:
        return Response(
            {"error": f"Nội dung tin nhắn không được vượt quá {MAX_USER_MESSAGE_CHARS} ký tự."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Daily rate limit check
    if not check_daily_rate_limit(user):
        return Response(
            {"error": "Bạn đã vượt quá giới hạn 100 lượt trò chuyện trong ngày hôm nay. Vui lòng quay lại vào ngày mai."},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    # Check for active running/queued chat job for this user
    active_job = AiChatJob.objects.filter(
        user=user,
        status__in=[AiChatJob.STATUS_QUEUED, AiChatJob.STATUS_RUNNING],
    ).first()
    if active_job:
        return Response(
            {
                "error": "Bạn đang có một câu hỏi đang được xử lý trong hàng chờ. Vui lòng chờ hoàn tất.",
                "job_id": active_job.id,
            },
            status=status.HTTP_409_CONFLICT,
        )

    # Check AI health
    health = AiServiceHealth.get_current()
    if health.status == AiServiceHealth.STATUS_AUTH_ERROR:
        return Response(
            {"error": "Dịch vụ Trợ lý AI đang tạm ngừng (cần quản trị viên đăng nhập lại). Bạn vẫn có thể dùng tính năng 'Tìm công cụ'."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    with transaction.atomic():
        session, _ = ChatSession.objects.get_or_create(user=user)
        session.save()  # update timestamp

        user_msg = ChatMessage.objects.create(
            session=session,
            user=user,
            role=ChatMessage.ROLE_USER,
            content=content,
        )

        job = AiChatJob.objects.create(
            user=user,
            session=session,
            user_message=content,
            status=AiChatJob.STATUS_QUEUED,
        )

    pos = get_chat_queue_position(job)
    return Response(
        {
            "job_id": job.id,
            "status": job.status,
            "queue_position": pos,
            "message_id": user_msg.id,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def chat_job_status(request, job_id: int):
    """Poll status of an active chat job."""
    user = request.user
    job = get_object_or_404(AiChatJob, id=job_id, user=user)

    response_data: Dict[str, Any] = {
        "job_id": job.id,
        "status": job.status,
        "queue_position": get_chat_queue_position(job) if job.status == AiChatJob.STATUS_QUEUED else None,
        "duration_seconds": job.duration_seconds,
    }

    if job.status == AiChatJob.STATUS_DONE:
        # Load fresh action statuses
        actions = []
        for a_dict in job.result_actions or []:
            try:
                action_obj = ChatAction.objects.get(id=a_dict["id"], user=user)
                action_obj.check_and_expire()
                actions.append({
                    "id": str(action_obj.id),
                    "tool_name": action_obj.tool_name,
                    "preview_description": action_obj.preview_description,
                    "diff_summary": action_obj.diff_summary,
                    "status": action_obj.status,
                    "expires_at": action_obj.expires_at.isoformat(),
                    "error_message": action_obj.error_message,
                })
            except ChatAction.DoesNotExist:
                actions.append(a_dict)

        response_data["result"] = {
            "message": job.result_text,
            "links": job.result_links or [],
            "actions": actions,
        }
    elif job.status == AiChatJob.STATUS_FAILED:
        response_data["error"] = job.error_message or "Không thể xử lý câu hỏi lúc này."

    return Response(response_data)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def cancel_chat_request(request, job_id: int):
    """Cancel a queued or running chat job."""
    user = request.user
    job = get_object_or_404(AiChatJob, id=job_id, user=user)
    try:
        cancelled = cancel_chat_job(job, user)
        return Response({"success": cancelled, "status": job.status})
    except PermissionError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_403_FORBIDDEN)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def confirm_chat_action(request, action_id):
    """Execute a pending write action card after user explicit confirmation."""
    user = request.user
    action = get_object_or_404(ChatAction, id=action_id, user=user)

    action.check_and_expire()
    if action.status == ChatAction.STATUS_EXPIRED:
        return Response(
            {"error": "Thao tác này đã hết hạn sau 10 phút. Vui lòng yêu cầu lại trong chat."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if action.status == ChatAction.STATUS_EXECUTED:
        return Response(
            {"error": "Thao tác này đã được thực thi trước đó."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if action.status == ChatAction.STATUS_CANCELLED:
        return Response(
            {"error": "Thao tác này đã bị hủy bỏ."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if action.status != ChatAction.STATUS_PENDING:
        return Response(
            {"error": f"Trạng thái hành động không hợp lệ ({action.status})."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Execute the tool
    try:
        result = execute_tool_safely(action.tool_name, action.arguments, user)
        if result.get("success") is False:
            action.status = ChatAction.STATUS_FAILED
            action.error_message = result.get("error", "Lỗi thực thi.")
            action.save(update_fields=["status", "error_message"])
            return Response(
                {"error": f"Thực thi thất bại: {action.error_message}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        action.status = ChatAction.STATUS_EXECUTED
        action.result = result
        action.executed_at = timezone.now()
        action.save(update_fields=["status", "result", "executed_at"])

        return Response({
            "success": True,
            "message": "Thao tác đã được thực hiện thành công.",
            "result": result,
            "action": {
                "id": str(action.id),
                "status": action.status,
            },
        })
    except PermissionError as exc:
        logger.warning("Permission denied confirming action %s for user %s: %s", action.id, user.email, exc)
        action.status = ChatAction.STATUS_FAILED
        action.error_message = str(exc)
        action.save(update_fields=["status", "error_message"])
        return Response({"error": str(exc)}, status=status.HTTP_403_FORBIDDEN)
    except ValueError as exc:
        logger.warning("Invalid value confirming action %s for user %s: %s", action.id, user.email, exc)
        action.status = ChatAction.STATUS_FAILED
        action.error_message = str(exc)
        action.save(update_fields=["status", "error_message"])
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        logger.error("Error confirming action %s for user %s: %s", action.id, user.email, exc, exc_info=True)
        action.status = ChatAction.STATUS_FAILED
        action.error_message = str(exc)
        action.save(update_fields=["status", "error_message"])
        return Response({"error": f"Lỗi hệ thống khi thực thi: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def cancel_chat_action(request, action_id):
    """Explicitly reject/cancel a pending write action card."""
    user = request.user
    action = get_object_or_404(ChatAction, id=action_id, user=user)

    if action.status in [ChatAction.STATUS_PENDING, ChatAction.STATUS_EXPIRED]:
        action.status = ChatAction.STATUS_CANCELLED
        action.save(update_fields=["status"])
        return Response({"success": True, "message": "Đã hủy thao tác."})

    return Response(
        {"error": f"Không thể hủy hành động ở trạng thái '{action.status}'."},
        status=status.HTTP_400_BAD_REQUEST,
    )


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def chatbot_health(request):
    """Return health status of the AI service for chatbot UI."""
    health = AiServiceHealth.get_current()
    return Response({
        "status": health.status,
        "is_ready": health.is_ready(),
        "error_message": health.error_message if health.status != AiServiceHealth.STATUS_READY else "",
    })
