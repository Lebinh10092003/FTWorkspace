"""
Views for Gmail Assistant:
- OAuth flow (authorize URL, callback, revoke & disconnect).
- Connection status & settings.
- Email digests list, filtering, and morning digest.
- Draft creation in Gmail (DRAFTS ONLY - NO SENDING).
- Weekly report note export.
- Job status polling.
"""

from datetime import datetime, timedelta
import logging
from typing import Any, Dict
import urllib.parse
import zoneinfo

from django.db import transaction
from django.db.models import Case, IntegerField, Q, Value, When
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.models import UserProfile
from authentication.permissions import IsWorkspaceAuthenticated
from documents.content_filter import clean_report_item
from documents.models import WeeklyReportSupplement
from documents.weekly_reports import week_start
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

    conn.save()
    return Response({
        "ai_enabled": conn.ai_enabled,
        "notify_new": conn.notify_new,
        "morning_scan_enabled": conn.morning_scan_enabled,
        "morning_time": conn.morning_time,
    })


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def list_digests_view(request):
    """
    List email digests with filtering and sorting:
    - filter: 'needs_reply', 'new_today', 'all'
    - priority: 'high', 'normal', 'low'
    - search: keyword search in subject or sender
    """
    user = request.user
    queryset = MailDigest.objects.filter(user=user)

    filter_type = request.query_params.get("filter", "all")
    if filter_type == "needs_reply":
        queryset = queryset.filter(needs_reply=True, status=MailDigest.STATUS_NEW)
    elif filter_type == "new_today":
        now_ict = timezone.now().astimezone(ICT_TZ)
        start_of_today = now_ict.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        queryset = queryset.filter(received_at__gte=start_of_today)

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
            "priority": d.priority,
            "needs_reply": d.needs_reply,
            "reply_by": d.reply_by,
            "summary": d.summary,
            "actions": d.actions,
            "status": d.status,
            "is_from_me": d.is_from_me,
        })

    return Response({
        "total": total,
        "page": page,
        "page_size": page_size,
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
    week_start_utc = week_start_dt.astimezone(timezone.utc)

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
            "sender": d.sender,
            "subject": d.subject,
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
        "unreplied_week": unreplied_count,
        "high_priority_unreplied": high_priority_count,
        "unreplied_items": top_unreplied,
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
    Returns queued MailJob ID or result if synchronous.
    """
    digest = get_object_or_404(MailDigest, id=digest_id, user=request.user)
    guidance = request.data.get("guidance", "").strip()

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
            },
        )
        return Response({"job_id": job.id, "status": job.status})
    except ValueError as val_err:
        return Response({"error": str(val_err)}, status=status.HTTP_400_BAD_REQUEST)


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
def add_to_report_view(request):
    """
    Export summaries of selected email digests into WeeklyReportSupplement.note of current week.
    Applies content_filter to guarantee clean, professional notes.
    """
    digest_ids = request.data.get("digest_ids", [])
    if not isinstance(digest_ids, list) or not digest_ids:
        return Response({"error": "Vui lòng chọn ít nhất một email."}, status=status.HTTP_400_BAD_REQUEST)

    digests = MailDigest.objects.filter(user=request.user, id__in=digest_ids)
    if not digests.exists():
        return Response({"error": "Không tìm thấy email hợp lệ."}, status=status.HTTP_404_NOT_FOUND)

    clean_items = []
    for d in digests:
        line = f"Xử lý email: {d.subject} (từ {d.sender})"
        if d.summary:
            # First line of summary
            summary_first = d.summary.splitlines()[0]
            line += f" - {summary_first}"
        cleaned = clean_report_item(line)
        if cleaned:
            clean_items.append(f"- {cleaned}")

    if not clean_items:
        return Response(
            {"error": "Nội dung các email được chọn không phù hợp để đưa vào báo cáo tuần."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Find or create WeeklyReportSupplement for current week
    current_week_start = week_start(timezone.now().date())
    supplement, _ = WeeklyReportSupplement.objects.get_or_create(
        user=request.user,
        week_start=current_week_start,
    )

    existing_note = (supplement.note or "").strip()
    new_snippet = "\n".join(clean_items)
    if existing_note:
        supplement.note = f"{existing_note}\n\n[Email công việc]\n{new_snippet}"
    else:
        supplement.note = f"[Email công việc]\n{new_snippet}"

    supplement.save(update_fields=["note", "updated_at"])
    return Response({
        "status": "success",
        "message": f"Đã bổ sung {len(clean_items)} đầu việc từ email vào ghi chú báo cáo tuần {current_week_start.isocalendar()[1]}.",
        "added_notes": clean_items,
    })


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
