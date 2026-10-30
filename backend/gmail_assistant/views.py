"""
Views for Gmail Assistant:
- OAuth flow (authorize URL, callback, revoke & disconnect).
- Connection status & settings.
- Email digests list, filtering, and morning digest.
- Draft creation in Gmail (DRAFTS ONLY - NO SENDING).
- Weekly report note export.
- Job status polling.
"""

from datetime import datetime, timedelta, timezone as dt_timezone
import logging
import re
from typing import Any, Dict
import urllib.parse
import zoneinfo

from django.db import transaction
from django.db.models import Case, IntegerField, Max, Q, Value, When
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_time
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.models import UserProfile
from authentication.permissions import IsWorkspaceAuthenticated
from work_schedule.models import WorkItem
from .ai_service import enqueue_mail_job, process_mail_job
from .gmail_client import GmailClient
from .models import GmailConnection, MailDigest, MailJob
from .security import (
    DEFAULT_ALLOWED_DOMAINS,
    decrypt_token,
    encrypt_token,
    generate_oauth_state,
    get_allowed_domains,
    get_oauth_credentials,
    is_allowed_email,
    is_oauth_configured,
    verify_oauth_state,
)
from .sync import ICT_TZ, sync_user_gmail

logger = logging.getLogger(__name__)

GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
]


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def gmail_status_view(request):
    """Return user's Gmail connection status and system OAuth configuration state."""
    user = request.user
    conn = GmailConnection.objects.filter(user=user).first()
    configured = is_oauth_configured()

    data = {
        "is_configured": configured,
        "connected": conn is not None,
        "email": conn.email if conn else "",
        "ai_enabled": conn.ai_enabled if conn else False,
        "notify_new": conn.notify_new if conn else True,
        "morning_scan_enabled": conn.morning_scan_enabled if conn else True,
        "morning_time": conn.morning_time if conn else "08:00",
        "superior_contacts": conn.superior_contacts if conn else [],
        "last_sync_at": conn.last_sync_at.isoformat() if conn and conn.last_sync_at else None,
        "allowed_domains": get_allowed_domains(),
    }
    return Response(data)


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def oauth_authorize_url_view(request):
    """Generate Google OAuth authorization URL with anti-CSRF state token."""
    if not is_oauth_configured():
        return Response(
            {"error": "Hệ thống chưa cấu hình Google OAuth Client ID / Secret hoặc Token Key."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    creds = get_oauth_credentials()
    client_id = creds["client_id"]
    redirect_uri = creds["redirect_uri"]
    if not redirect_uri:
        # Default redirect to frontend callback
        redirect_uri = request.build_absolute_uri("/communication-tools/gmail")

    state = generate_oauth_state(request.user.email)
    scope_str = " ".join(GMAIL_SCOPES)

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scope_str,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"
    return Response({"authorize_url": auth_url, "state": state, "redirect_uri": redirect_uri})


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def oauth_callback_view(request):
    """
    Handle Google OAuth callback:
    - Verifies anti-CSRF state.
    - Exchanges authorization code for tokens.
    - Validates email domain (@fermat.vn or user's email).
    - Encrypts refresh token and stores connection.
    """
    code = request.data.get("code")
    state = request.data.get("state")
    redirect_uri = request.data.get("redirect_uri")

    if not code or not state:
        return Response({"error": "Thiếu mã xác thực (code) hoặc state."}, status=status.HTTP_400_BAD_REQUEST)

    if not verify_oauth_state(state, request.user.email):
        return Response(
            {"error": "Mã bảo mật state không hợp lệ hoặc đã hết hạn (15 phút). Vui lòng thử lại."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not redirect_uri:
        creds = get_oauth_credentials()
        redirect_uri = creds.get("redirect_uri") or request.build_absolute_uri("/communication-tools/gmail")
    elif "?" in redirect_uri:
        redirect_uri = redirect_uri.split("?")[0]

    try:
        token_data = GmailClient.exchange_code_for_tokens(code, redirect_uri)
    except Exception as exc:
        logger.error("Lỗi đổi token Google: %s", exc)
        return Response({"error": f"Không thể kết nối với Google: {exc}"}, status=status.HTTP_400_BAD_REQUEST)

    refresh_token = token_data.get("refresh_token")
    access_token = token_data.get("access_token")

    if not refresh_token:
        # If user previously authorized without consent prompt, refresh_token might be absent
        existing = GmailConnection.objects.filter(user=request.user).first()
        if existing:
            refresh_token = decrypt_token(existing.encrypted_refresh_token)
        else:
            return Response(
                {"error": "Google không trả về refresh token. Hãy hủy quyền trên Google và thử lại với prompt=consent."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    # Get user profile email from Gmail API
    client = GmailClient(refresh_token=refresh_token, access_token=access_token)
    try:
        profile = client.get_profile()
        gmail_email = profile.get("emailAddress", "").strip().lower()
    except Exception as exc:
        return Response({"error": f"Không thể lấy thông tin email từ Gmail: {exc}"}, status=status.HTTP_400_BAD_REQUEST)

    # Domain verification
    if not is_allowed_email(gmail_email, request.user.email):
        allowed = ", ".join(f"@{d}" for d in get_allowed_domains())
        return Response(
            {"error": f"Email '{gmail_email}' không thuộc tên miền được phép ({allowed}) hoặc tài khoản của bạn."},
            status=status.HTTP_403_FORBIDDEN,
        )

    encrypted = encrypt_token(refresh_token)

    with transaction.atomic():
        conn, _ = GmailConnection.objects.update_or_create(
            user=request.user,
            defaults={
                "email": gmail_email,
                "encrypted_refresh_token": encrypted,
                "scopes": ",".join(GMAIL_SCOPES),
            },
        )

    logger.info("Người dùng %s đã kết nối thành công Gmail: %s", request.user.email, gmail_email)
    return Response({"status": "connected", "email": gmail_email})


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def disconnect_view(request):
    """
    Disconnect Gmail and permanently delete all user's email digests & background jobs.
    Revokes the token at Google.
    """
    conn = GmailConnection.objects.filter(user=request.user).first()
    if conn:
        try:
            client = GmailClient.from_connection(conn)
            client.revoke_token()
        except Exception as exc:
            logger.warning("Lỗi thu hồi token Google khi ngắt kết nối: %s", exc)

        with transaction.atomic():
            MailDigest.objects.filter(user=request.user).delete()
            MailJob.objects.filter(user=request.user).delete()
            conn.delete()

    return Response({"status": "disconnected", "message": "Đã ngắt kết nối và xóa toàn bộ dữ liệu email."})


@api_view(["PATCH"])
@permission_classes([IsWorkspaceAuthenticated])
def update_settings_view(request):
    """Update user's Gmail connection preferences."""
    conn = get_object_or_404(GmailConnection, user=request.user)
    data = request.data

    if "ai_enabled" in data:
        conn.ai_enabled = bool(data["ai_enabled"])
    if "notify_new" in data:
        conn.notify_new = bool(data["notify_new"])
    if "morning_scan_enabled" in data:
        conn.morning_scan_enabled = bool(data["morning_scan_enabled"])
    if "morning_time" in data:
        raw_time = str(data["morning_time"]).strip()
        if re.match(r"^\d{1,2}:\d{2}$", raw_time):
            conn.morning_time = raw_time
    if "superior_contacts" in data:
        raw_contacts = data["superior_contacts"]
        if isinstance(raw_contacts, list):
            clean_contacts = [str(c).strip() for c in raw_contacts if str(c).strip()]
            conn.superior_contacts = clean_contacts

    conn.save()
    return Response({
        "ai_enabled": conn.ai_enabled,
        "notify_new": conn.notify_new,
        "morning_scan_enabled": conn.morning_scan_enabled,
        "morning_time": conn.morning_time,
        "superior_contacts": conn.superior_contacts,
    })


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def list_digests_view(request):
    """
    List email digests with filtering and sorting:
    - tab/filter: 'all', 'needs_reply', 'cc', 'new_today', 'today', 'unhandled', 'handled'
    - status: 'all', 'unhandled', 'handled', 'new', 'replied', 'ignored'
    - priority: 'high', 'normal', 'low'
    - search: keyword search in subject or sender
    """
    user = request.user
    base_queryset = MailDigest.objects.filter(user=user)

    now_ict = timezone.now().astimezone(ICT_TZ)
    start_of_today = now_ict.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(dt_timezone.utc)

    # Compute tab counts for badges
    counts = {
        "all": base_queryset.count(),
        "needs_reply": base_queryset.filter(needs_reply=True, status=MailDigest.STATUS_NEW).count(),
        "cc": base_queryset.filter(recipient_role=MailDigest.RECIPIENT_ROLE_CC).count(),
        "today": base_queryset.filter(received_at__gte=start_of_today).count(),
        "unhandled": base_queryset.filter(status=MailDigest.STATUS_NEW).count(),
        "handled": base_queryset.filter(status__in=[MailDigest.STATUS_REPLIED, MailDigest.STATUS_IGNORED]).count(),
    }

    queryset = base_queryset

    # Tab / main filter
    filter_type = request.query_params.get("filter") or request.query_params.get("tab") or "all"
    if filter_type == "needs_reply":
        queryset = queryset.filter(needs_reply=True, status=MailDigest.STATUS_NEW)
    elif filter_type == "cc":
        queryset = queryset.filter(recipient_role=MailDigest.RECIPIENT_ROLE_CC)
    elif filter_type in ("new_today", "today"):
        queryset = queryset.filter(received_at__gte=start_of_today)
    elif filter_type == "unhandled":
        queryset = queryset.filter(status=MailDigest.STATUS_NEW)
    elif filter_type == "handled":
        queryset = queryset.filter(status__in=[MailDigest.STATUS_REPLIED, MailDigest.STATUS_IGNORED])

    # Status secondary filter
    status_param = request.query_params.get("status")
    if status_param == "unhandled":
        queryset = queryset.filter(status=MailDigest.STATUS_NEW)
    elif status_param == "handled":
        queryset = queryset.filter(status__in=[MailDigest.STATUS_REPLIED, MailDigest.STATUS_IGNORED])
    elif status_param in {MailDigest.STATUS_NEW, MailDigest.STATUS_REPLIED, MailDigest.STATUS_IGNORED}:
        queryset = queryset.filter(status=status_param)

    priority = request.query_params.get("priority")
    if priority in {MailDigest.PRIORITY_HIGH, MailDigest.PRIORITY_NORMAL, MailDigest.PRIORITY_LOW}:
        queryset = queryset.filter(priority=priority)

    search = request.query_params.get("search", "").strip()
    if search:
        queryset = queryset.filter(Q(subject__icontains=search) | Q(sender__icontains=search))

    # Priority sorting: high (1) -> normal (2) -> low (3), then received_at descending
    queryset = queryset.annotate(
        priority_rank=Case(
            When(priority=MailDigest.PRIORITY_HIGH, then=Value(1)),
            When(priority=MailDigest.PRIORITY_NORMAL, then=Value(2)),
            default=Value(3),
            output_field=IntegerField(),
        )
    ).order_by("priority_rank", "-received_at")

    # Pagination
    try:
        page = max(1, int(request.query_params.get("page", 1)))
        page_size = min(50, max(5, int(request.query_params.get("page_size", 20))))
    except ValueError:
        page, page_size = 1, 20

    total = queryset.count()
    start_idx = (page - 1) * page_size
    items = queryset[start_idx : start_idx + page_size]

    results = []
    for d in items:
        results.append({
            "id": d.id,
            "message_id": d.message_id,
            "thread_id": d.thread_id,
            "sender": d.sender,
            "sender_email": d.sender_email,
            "subject": d.subject,
            "received_at": d.received_at.isoformat(),
            "recipient_role": d.recipient_role,
            "addressed_by_name": d.addressed_by_name,
            "match_reason": d.match_reason,
            "priority": d.priority,
            "needs_reply": d.needs_reply,
            "reply_by": d.reply_by,
            "summary": d.summary,
            "actions": d.actions,
            "schedule_items": d.schedule_items or [],
            "status": d.status,
            "is_from_me": d.is_from_me,
        })

    return Response({
        "total": total,
        "page": page,
        "page_size": page_size,
        "counts": counts,
        "results": results,
    })


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def morning_digest_view(request):
    """
    Provide aggregated statistics and unreplied list for the morning card:
    - new_past_day count (24h)
    - unreplied_week count
    - high_priority_unreplied count
    - top unreplied digests
    """
    user = request.user
    now_utc = timezone.now()
    past_24h = now_utc - timedelta(hours=24)

    now_ict = now_utc.astimezone(ICT_TZ)
    week_start_dt = (now_ict - timedelta(days=now_ict.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    week_start_utc = week_start_dt.astimezone(dt_timezone.utc)

    new_past_day = MailDigest.objects.filter(
        user=user,
        received_at__gte=past_24h,
        is_from_me=False,
    ).count()

    unreplied_qs = MailDigest.objects.filter(
        user=user,
        received_at__gte=week_start_utc,
        needs_reply=True,
        status=MailDigest.STATUS_NEW,
        is_from_me=False,
    )
    unreplied_count = unreplied_qs.count()
    high_priority_count = unreplied_qs.filter(priority=MailDigest.PRIORITY_HIGH).count()

    top_unreplied = [
        {
            "id": d.id,
            "thread_id": d.thread_id,
            "sender": d.sender,
            "subject": d.subject,
            "date": d.received_at.isoformat(),
            "received_at": d.received_at.isoformat(),
            "priority": d.priority,
            "reply_by": d.reply_by,
            "summary": d.summary,
        }
        for d in unreplied_qs.order_by(
            Case(
                When(priority=MailDigest.PRIORITY_HIGH, then=Value(1)),
                default=Value(2),
                output_field=IntegerField(),
            ),
            "-received_at",
        )[:10]
    ]

    return Response({
        "new_past_day": new_past_day,
        "recent_count": new_past_day,
        "unreplied_week": unreplied_count,
        "unreplied_count": unreplied_count,
        "high_priority_unreplied": high_priority_count,
        "unreplied_items": top_unreplied,
        "unreplied_threads": top_unreplied,
        "top_unreplied": top_unreplied,
    })


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def update_digest_status_view(request, digest_id):
    """Update status of an email digest (new, replied, ignored)."""
    digest = get_object_or_404(MailDigest, id=digest_id, user=request.user)
    new_status = request.data.get("status")

    if new_status in {MailDigest.STATUS_NEW, MailDigest.STATUS_REPLIED, MailDigest.STATUS_IGNORED}:
        digest.status = new_status
        if new_status in {MailDigest.STATUS_REPLIED, MailDigest.STATUS_IGNORED}:
            digest.needs_reply = False
        digest.save(update_fields=["status", "needs_reply", "updated_at"])
        return Response({"status": "updated", "digest_status": digest.status})

    return Response({"error": "Trạng thái không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def draft_reply_ai_view(request, digest_id):
    """
    Queue AI drafting of response for an email digest.
    Applies superior tone if sender matches superior contacts list.
    Returns queued MailJob ID or result if synchronous.
    """
    digest = get_object_or_404(MailDigest, id=digest_id, user=request.user)
    guidance = request.data.get("guidance", "").strip()

    conn = GmailConnection.objects.filter(user=request.user).first()
    is_superior = bool(request.data.get("is_superior", False))
    if not is_superior and conn and conn.superior_contacts:
        sender_lower = (digest.sender or "").lower()
        sender_email_lower = (digest.sender_email or "").lower()
        for contact in conn.superior_contacts:
            c = str(contact).strip().lower()
            if c and (c in sender_lower or c in sender_email_lower):
                is_superior = True
                break

    user_name = (getattr(request.user, "name", "") or request.user.username or "").strip()

    try:
        job = enqueue_mail_job(
            user=request.user,
            job_type=MailJob.TYPE_DRAFT_REPLY,
            payload={
                "digest_id": digest.id,
                "subject": digest.subject,
                "sender": digest.sender,
                "summary": digest.summary,
                "guidance": guidance,
                "user_name": user_name,
                "is_superior": is_superior,
                "actions": digest.actions or [],
            },
        )
        return Response({"job_id": job.id, "status": job.status})
    except ValueError as val_err:
        return Response({"error": str(val_err)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def toggle_action_view(request, digest_id):
    """
    Toggle completion status of a specific action item within a MailDigest.
    Payload: {"action_index": 0, "completed": true|false}
    """
    digest = get_object_or_404(MailDigest, id=digest_id, user=request.user)
    action_index = request.data.get("action_index")
    if action_index is None:
        return Response({"error": "Thiếu chỉ số công việc (action_index)."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        idx = int(action_index)
    except ValueError:
        return Response({"error": "action_index không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)

    actions = digest.actions or []
    if idx < 0 or idx >= len(actions):
        return Response({"error": f"Không tìm thấy công việc ở vị trí {idx}."}, status=status.HTTP_404_NOT_FOUND)

    item = actions[idx]
    if isinstance(item, str):
        item = {
            "type": "khac",
            "title": item,
            "deadline": "",
            "required_preparations": [],
            "priority": "normal",
            "completed": False,
        }

    if "completed" in request.data:
        item["completed"] = bool(request.data["completed"])
    else:
        item["completed"] = not bool(item.get("completed", False))

    actions[idx] = item
    digest.actions = actions
    digest.save(update_fields=["actions", "updated_at"])

    return Response({
        "status": "updated",
        "action_index": idx,
        "completed": item["completed"],
        "actions": digest.actions,
    })


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def analyze_digest_view(request, digest_id):
    """
    Manually trigger AI analysis for an unanalyzed email digest.
    Fetches email body via GmailClient if not cached, then queues TYPE_SUMMARIZE job.
    """
    digest = get_object_or_404(MailDigest, id=digest_id, user=request.user)
    conn = get_object_or_404(GmailConnection, user=request.user)

    body_text = ""
    try:
        client = GmailClient.from_connection(conn)
        msg_data = client.get_message(digest.message_id)
        body_text = msg_data.get("body", "")
    except Exception as exc:
        logger.warning("Không thể đọc thân thư từ Gmail cho digest %s: %s", digest.id, exc)

    job = enqueue_mail_job(
        user=request.user,
        job_type=MailJob.TYPE_SUMMARIZE,
        payload={
            "digest_id": digest.id,
            "message_id": digest.message_id,
            "sender": digest.sender,
            "subject": digest.subject,
            "date": digest.received_at.strftime("%d/%m/%Y %H:%M"),
            "body": body_text,
        },
    )
    return Response({"status": "queued", "job_id": job.id})


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def create_draft_view(request):
    """
    Save drafted email into Gmail Drafts folder.
    SECURITY ASSURANCE:
    - ONLY calls drafts.create.
    - ABSOLUTELY DOES NOT SEND the email.
    """
    conn = get_object_or_404(GmailConnection, user=request.user)
    thread_id = request.data.get("thread_id", "").strip()
    to_email = request.data.get("to_email", "").strip()
    subject = request.data.get("subject", "").strip()
    body_text = request.data.get("body_text", "").strip()
    in_reply_to = request.data.get("in_reply_to")
    references = request.data.get("references")
    digest_id = request.data.get("digest_id")

    if not to_email or not body_text:
        return Response({"error": "Thiếu người nhận hoặc nội dung thư."}, status=status.HTTP_400_BAD_REQUEST)

    client = GmailClient.from_connection(conn)
    try:
        draft_res = client.create_draft(
            thread_id=thread_id,
            to_email=to_email,
            subject=subject,
            body_text=body_text,
            in_reply_to=in_reply_to,
            references=references,
        )

        # Mark digest as replied
        if digest_id:
            digest = MailDigest.objects.filter(id=digest_id, user=request.user).first()
            if digest:
                digest.status = MailDigest.STATUS_REPLIED
                digest.needs_reply = False
                digest.save(update_fields=["status", "needs_reply", "updated_at"])

        return Response({
            "status": "success",
            "draft_id": draft_res.get("id"),
            "notice": "Đã lưu bản nháp vào Gmail thành công. Vui lòng mở Gmail → Thư nháp để kiểm tra và gửi.",
        })
    except Exception as exc:
        logger.error("Lỗi tạo bản nháp Gmail: %s", exc)
        return Response({"error": f"Không thể lưu nháp vào Gmail: {exc}"}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def add_to_schedule_view(request, digest_id):
    """
    Create WorkItem(s) in work_schedule for the authenticated user from action items of an email digest.
    Guarantees:
    - Executor is the user themselves.
    - Default label='Công việc', status='todo'.
    - Stores references in digest.schedule_items to prevent accidental duplicates.
    - User can edit all fields before creating (only created when confirmed).
    """
    digest = get_object_or_404(MailDigest, id=digest_id, user=request.user)
    items_data = request.data.get("items")
    if items_data is None:
        items_data = [request.data]

    if not isinstance(items_data, list) or not items_data:
        return Response({"error": "Danh sách công việc không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)

    created_work_items = []
    updated_schedule_items = list(digest.schedule_items or [])
    current_actions = list(digest.actions or [])

    with transaction.atomic():
        for item_data in items_data:
            title = str(item_data.get("title", "")).strip()
            if not title:
                return Response({"error": "Tiêu đề công việc không được để trống."}, status=status.HTTP_400_BAD_REQUEST)

            work_date_str = str(item_data.get("work_date", "")).strip()
            work_date = parse_date(work_date_str)
            if not work_date:
                return Response(
                    {"error": f"Ngày thực hiện '{work_date_str}' không hợp lệ (định dạng YYYY-MM-DD)."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            start_time_raw = str(item_data.get("start_time", "")).strip()
            end_time_raw = str(item_data.get("end_time", "")).strip()
            start_time = parse_time(start_time_raw) if start_time_raw else None
            end_time = parse_time(end_time_raw) if end_time_raw else None

            prio = str(item_data.get("priority", "medium")).lower()
            if prio not in {"low", "medium", "high"}:
                prio = "medium"

            description = str(item_data.get("description", "")).strip()
            action_index = item_data.get("action_index")

            # Determine next daily order for this date
            highest_order = (
                WorkItem.objects.filter(executor=request.user, work_date=work_date)
                .aggregate(highest=Max("daily_order"))["highest"]
                or 0
            )
            daily_order = highest_order + 1

            work_item = WorkItem.objects.create(
                creator=request.user,
                executor=request.user,
                title=title[:1000],
                description=description,
                work_date=work_date,
                start_time=start_time,
                end_time=end_time,
                priority=prio,
                status=WorkItem.STATUS_TODO,
                label="Công việc",
                daily_order=daily_order,
            )

            # Assign user's manager if available
            if getattr(request.user, "manager", None):
                work_item.managers.set([request.user.manager])

            created_work_items.append({
                "id": work_item.id,
                "title": work_item.title,
                "work_date": work_item.work_date.isoformat(),
            })

            # Record link in digest.schedule_items
            schedule_record = {
                "work_item_id": work_item.id,
                "title": work_item.title,
                "work_date": work_item.work_date.isoformat(),
                "action_index": action_index,
                "created_at": timezone.now().isoformat(),
            }
            updated_schedule_items.append(schedule_record)

            # Auto-mark action as completed if action_index valid
            if action_index is not None:
                try:
                    idx = int(action_index)
                    if 0 <= idx < len(current_actions):
                        act = current_actions[idx]
                        if isinstance(act, dict):
                            act["completed"] = True
                        elif isinstance(act, str):
                            current_actions[idx] = {
                                "type": "khac",
                                "title": act,
                                "deadline": "",
                                "required_preparations": [],
                                "priority": "normal",
                                "completed": True,
                            }
                except ValueError:
                    pass

        digest.schedule_items = updated_schedule_items
        digest.actions = current_actions
        digest.save(update_fields=["schedule_items", "actions", "updated_at"])

    return Response({
        "status": "success",
        "message": f"Đã thêm {len(created_work_items)} việc vào lịch công tác ngày {created_work_items[0]['work_date']}.",
        "created_items": created_work_items,
        "schedule_items": digest.schedule_items,
    }, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def trigger_sync_view(request):
    """Manually trigger email synchronization for the authenticated user."""
    conn = get_object_or_404(GmailConnection, user=request.user)
    try:
        res = sync_user_gmail(conn, max_fetch=20)
        return Response({
            "status": "success",
            "new_count": res.get("new_count", 0),
            "needs_reply_count": res.get("needs_reply_count", 0),
        })
    except Exception as exc:
        logger.error("Lỗi đồng bộ thủ công Gmail cho %s: %s", request.user.email, exc)
        return Response({"error": f"Lỗi đồng bộ: {exc}"}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def get_job_status_view(request, job_id):
    """Poll status of a background MailJob."""
    job = get_object_or_404(MailJob, id=job_id, user=request.user)
    return Response({
        "id": job.id,
        "job_type": job.job_type,
        "status": job.status,
        "result": job.result,
        "error_message": job.error_message,
        "duration_seconds": job.duration_seconds,
    })
