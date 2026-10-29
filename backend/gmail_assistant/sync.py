"""
Gmail synchronization, unreplied detection, morning scan, and digest cleanup.
"""

from datetime import datetime, timedelta, timezone as dt_timezone
import logging
import re
from typing import Any, Dict, List, Optional, Tuple
import zoneinfo

from django.utils import timezone

from authentication.notifications import notify_workspace
from .ai_service import enqueue_mail_job
from .gmail_client import GmailClient
from .models import GmailConnection, MailDigest, MailJob

logger = logging.getLogger(__name__)

IGNORE_SENDER_PATTERNS = re.compile(
    r"(?i)\b(?:noreply|no-reply|mailer-daemon|notifications?@|donotreply|do-not-reply|bounce)\b"
)
IGNORE_LABELS = {"CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES"}
ICT_TZ = zoneinfo.ZoneInfo("Asia/Ho_Chi_Minh")


def is_automated_or_ignored(sender_email: str, label_ids: Optional[List[str]] = None) -> bool:
    """Return True if message is automated/notification/marketing that should be ignored."""
    if sender_email and IGNORE_SENDER_PATTERNS.search(sender_email):
        return True
    if label_ids:
        if any(lbl in IGNORE_LABELS for lbl in label_ids):
            return True
    return False


def check_if_thread_unreplied(
    client: GmailClient,
    thread_id: str,
    user_email: str,
    hours_threshold: int = 24,
) -> bool:
    """
    Check if a thread is unreplied:
    - Last message in thread is NOT from the user.
    - Last message is older than hours_threshold.
    """
    try:
        thread_data = client.get_thread(thread_id)
        messages = thread_data.get("messages", [])
        if not messages:
            return False

        last_msg = messages[-1]
        last_payload = last_msg.get("payload", {})
        headers = {h.get("name", "").casefold(): h.get("value", "") for h in last_payload.get("headers", [])}

        sender_raw = headers.get("from", "")
        _, sender_email = client._parse_sender(sender_raw)

        # If user is the last sender, it is already replied!
        if sender_email.lower() == user_email.lower():
            return False

        # Check timestamp
        internal_date_ms = int(last_msg.get("internalDate") or 0)
        if internal_date_ms:
            msg_dt = datetime.fromtimestamp(internal_date_ms / 1000.0, tz=dt_timezone.utc)
            if timezone.now() - msg_dt >= timedelta(hours=hours_threshold):
                return True

        return True
    except Exception as exc:
        logger.warning("Lỗi kiểm tra thread unreplied #%s: %s", thread_id, exc)
        return False


def sync_user_gmail(connection: GmailConnection, max_fetch: int = 20) -> Dict[str, Any]:
    """
    Sync recent messages from Gmail for one user connection:
    - Lists up to max_fetch messages (default 20).
    - Extracts metadata and creates MailDigest records.
    - If ai_enabled, enqueues summarize MailJob.
    - Sends bundled notification via notify_workspace if new messages found.
    """
    client = GmailClient.from_connection(connection)
    query = "newer_than:1d in:inbox -category:promotions"

    list_resp = client.list_messages(query=query, max_results=max_fetch)
    messages_refs = list_resp.get("messages", [])

    new_count = 0
    needs_reply_count = 0

    for ref in messages_refs:
        msg_id = ref.get("id")
        thread_id = ref.get("threadId")
        if not msg_id:
            continue

        existing = MailDigest.objects.filter(user=connection.user, message_id=msg_id).first()
        if existing:
            continue

        try:
            msg_data = client.get_message(msg_id)
            sender_email = msg_data.get("from_email", "")
            from_name = msg_data.get("from_name", "")
            subject = msg_data.get("subject", "(Không có tiêu đề)")
            body = msg_data.get("body", "")
            label_ids = msg_data.get("labelIds", [])

            # Parse received date
            internal_ms = int(msg_data.get("internalDate") or 0)
            if internal_ms:
                received_at = datetime.fromtimestamp(internal_ms / 1000.0, tz=dt_timezone.utc)
            else:
                received_at = timezone.now()

            is_from_me = sender_email.lower() == connection.email.lower()
            is_automated = is_automated_or_ignored(sender_email, label_ids)

            # Heuristic for needs_reply
            needs_reply = False
            priority = MailDigest.PRIORITY_NORMAL
            if is_automated or is_from_me:
                priority = MailDigest.PRIORITY_LOW
                needs_reply = False
            else:
                # Check thread to see if already answered or waiting for reply
                is_unreplied = check_if_thread_unreplied(client, thread_id, connection.email, hours_threshold=0)
                if is_unreplied:
                    needs_reply = True
                    needs_reply_count += 1

            digest = MailDigest.objects.create(
                user=connection.user,
                message_id=msg_id,
                thread_id=thread_id,
                sender=from_name or sender_email,
                sender_email=sender_email,
                subject=subject,
                received_at=received_at,
                priority=priority,
                needs_reply=needs_reply,
                status=MailDigest.STATUS_NEW,
                is_from_me=is_from_me,
            )
            new_count += 1

            # If user has opted in for AI analysis, enqueue summarization job
            if connection.ai_enabled and not is_from_me and not is_automated:
                try:
                    enqueue_mail_job(
                        user=connection.user,
                        job_type=MailJob.TYPE_SUMMARIZE,
                        payload={
                            "message_id": msg_id,
                            "thread_id": thread_id,
                            "sender": f"{from_name} <{sender_email}>" if from_name else sender_email,
                            "subject": subject,
                            "date": received_at.strftime("%Y-%m-%d %H:%M"),
                            "body": body,
                        },
                    )
                except Exception as q_err:
                    logger.warning("Không thể xếp job tóm tắt cho email %s: %s", msg_id, q_err)

        except Exception as exc:
            logger.error("Lỗi đồng bộ email message #%s: %s", msg_id, exc)

    connection.last_sync_at = timezone.now()
    connection.save(update_fields=["last_sync_at", "updated_at"])

    # Notify user if notify_new is turned on and new emails arrived
    if new_count > 0 and connection.notify_new:
        now_ict = timezone.now().astimezone(ICT_TZ)
        event_key = f"gmail_sync_{connection.user.pk}_{now_ict.strftime('%Y%m%d%H%M')}"
        title = f"Hộp thư: {new_count} thư mới"
        if needs_reply_count > 0:
            msg = f"Bạn có {new_count} thư mới ({needs_reply_count} thư cần phản hồi). Hãy kiểm tra trong tab Hộp thư AI."
        else:
            msg = f"Bạn có {new_count} thư mới vừa nhận trong hộp thư Gmail."

        notify_workspace(
            event_key=event_key,
            title=title,
            message=msg,
            severity="info",
            category="gmail",
            target_emails=[connection.user.email],
            action_url="/communication-tools/gmail",
        )

    return {
        "new_count": new_count,
        "needs_reply_count": needs_reply_count,
    }


def run_morning_scan_for_user(connection: GmailConnection, now_ict: Optional[datetime] = None) -> bool:
    """
    Run morning digest scan for user:
    - Gathers: unreplied emails of the week + new emails of the past 24 hours.
    - Sends morning notification.
    - Idempotent: runs only once per calendar day.
    """
    if now_ict is None:
        now_ict = timezone.now().astimezone(ICT_TZ)

    today = now_ict.date()
    if connection.last_morning_date == today:
        return False

    now_utc = timezone.now()
    past_24h = now_utc - timedelta(hours=24)
    # Start of Monday in current week
    week_start = now_ict - timedelta(days=now_ict.weekday())
    week_start_utc = week_start.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(dt_timezone.utc)

    # 1. Thư trong 24 giờ qua
    new_past_day = MailDigest.objects.filter(
        user=connection.user,
        received_at__gte=past_24h,
        is_from_me=False,
    ).count()

    # 2. Thư trong tuần chưa phản hồi
    unreplied_week = MailDigest.objects.filter(
        user=connection.user,
        received_at__gte=week_start_utc,
        needs_reply=True,
        status=MailDigest.STATUS_NEW,
        is_from_me=False,
    ).count()

    # High priority unreplied
    high_priority_count = MailDigest.objects.filter(
        user=connection.user,
        received_at__gte=week_start_utc,
        needs_reply=True,
        status=MailDigest.STATUS_NEW,
        priority=MailDigest.PRIORITY_HIGH,
        is_from_me=False,
    ).count()

    event_key = f"gmail_morning_{connection.user.pk}_{today.isoformat()}"
    title = f"Thư buổi sáng ({today.strftime('%d/%m')}): {new_past_day} thư mới, {unreplied_week} chưa phản hồi"
    msg_parts = [
        f"Chào buổi sáng! Bạn có {new_past_day} thư nhận được trong 24h qua.",
        f"Có {unreplied_week} thư trong tuần chưa phản hồi.",
    ]
    if high_priority_count > 0:
        msg_parts.append(f"Trong đó có {high_priority_count} thư mức ưu tiên CAO cần giải quyết sớm.")
    msg_parts.append("Mở tab Hộp thư AI để xem tóm tắt và soạn phản hồi nhanh.")

    notify_workspace(
        event_key=event_key,
        title=title,
        message=" ".join(msg_parts),
        severity="info" if high_priority_count == 0 else "warning",
        category="gmail",
        target_emails=[connection.user.email],
        action_url="/communication-tools/gmail",
    )

    connection.last_morning_date = today
    connection.save(update_fields=["last_morning_date", "updated_at"])
    return True


def cleanup_old_digests(days: int = 30) -> int:
    """Delete digests older than specified days (default 30 days) to keep database minimal."""
    cutoff = timezone.now() - timedelta(days=days)
    count, _ = MailDigest.objects.filter(received_at__lt=cutoff).delete()
    logger.info("Đã dọn dẹp %d bản ghi MailDigest cũ hơn %d ngày.", count, days)
    return count
