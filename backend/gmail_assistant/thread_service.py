"""
Thread aggregation service for Gmail digests.
Groups individual message digests sharing the same thread_id (or subject) into a single thread card
with chronological timeline, unified summary, merged actions, and unreplied status calculation.
"""

from collections import OrderedDict
from datetime import datetime, timezone as dt_timezone
import re
from typing import Any, Dict, List, Optional, Tuple

from django.utils import timezone

from .models import MailDigest


CLEAN_SUBJECT_REGEX = re.compile(r"^(?:(?:re|fwd|fw|v/v)\s*[:：]\s*)+", re.IGNORECASE)


def clean_subject(subject: str) -> str:
    """
    Remove repeated prefixes like 'Re:', 'Fwd:', 'FW:', 'V/v:' from email subjects.
    Returns clean title.
    """
    if not subject:
        return "(Không có tiêu đề)"
    cleaned = CLEAN_SUBJECT_REGEX.sub("", subject.strip()).strip()
    # Handle nested cleanups like 'Re: V/v'
    while CLEAN_SUBJECT_REGEX.match(cleaned):
        cleaned = CLEAN_SUBJECT_REGEX.sub("", cleaned).strip()
    return cleaned or subject.strip() or "(Không có tiêu đề)"


def get_thread_key(digest: MailDigest) -> str:
    """
    Determine group key for a message digest:
    Prefer thread_id; fallback to clean subject lowercased if thread_id is absent.
    """
    tid = (digest.thread_id or "").strip()
    if tid:
        return f"tid:{tid}"
    subj = clean_subject(digest.subject).strip().casefold()
    return f"subj:{subj}"


def calculate_thread_needs_reply(messages: List[MailDigest]) -> Tuple[bool, str]:
    """
    Determine whether the thread needs a reply according to Section G:
    - If the latest message in the thread is from the user (is_from_me=True), the user has already replied => False.
    - If the thread is marked as replied/ignored => False.
    - Otherwise, find the last time the user sent a message in the thread (if any).
      Check messages received AFTER that time:
      If any unreplied message was sent directly (To) or addresses the user by name => True.
      If messages received after are only CC (not addressed by name) => False.
    - If the user never sent a message in the thread:
      If any message is To or addresses the user by name => True; else False.
    """
    if not messages:
        return False, ""

    sorted_msgs = sorted(messages, key=lambda m: m.received_at)
    latest = sorted_msgs[-1]

    # 1. If latest message was sent by the user, thread is considered replied
    if latest.is_from_me:
        return False, "Đã phản hồi (thư mới nhất do bạn gửi)"

    # 2. If latest status is explicitly replied or ignored
    if latest.status in (MailDigest.STATUS_REPLIED, MailDigest.STATUS_IGNORED):
        return False, "Luồng đã được xử lý"

    # 3. Find latest message sent by user in this thread
    sent_by_me = [m for m in sorted_msgs if m.is_from_me]
    if sent_by_me:
        last_sent_dt = sent_by_me[-1].received_at
        unanswered_msgs = [m for m in sorted_msgs if m.received_at > last_sent_dt and not m.is_from_me]
    else:
        unanswered_msgs = [m for m in sorted_msgs if not m.is_from_me]

    if not unanswered_msgs:
        return False, "Đã phản hồi"

    # Check for direct 'To' or 'addressed_by_name' among unanswered messages
    for m in reversed(unanswered_msgs):
        if m.recipient_role == MailDigest.RECIPIENT_ROLE_TO or m.addressed_by_name:
            reason = m.match_reason or ("Gửi trực tiếp (To)" if m.recipient_role == MailDigest.RECIPIENT_ROLE_TO else "Được gọi tên trong thư")
            return True, reason

    # If all unanswered messages were only CC
    return False, "Chỉ nhận bản sao (CC)"


def merge_thread_actions(messages: List[MailDigest]) -> List[Dict[str, Any]]:
    """
    Merge and deduplicate action items from all messages in the thread.
    Deduplicates by action title (casefold).
    Combines required_preparations, keeps completed=True if marked, preserves latest deadline/priority.
    """
    actions_map: Dict[str, Dict[str, Any]] = OrderedDict()

    # Process from oldest to newest so newer actions take precedence for deadline/priority
    sorted_msgs = sorted(messages, key=lambda m: m.received_at)

    for msg in sorted_msgs:
        msg_actions = msg.actions or []
        if isinstance(msg_actions, dict):
            msg_actions = [msg_actions]
        elif not isinstance(msg_actions, list):
            continue

        for act in msg_actions:
            if not isinstance(act, dict):
                continue
            title = str(act.get("title", "")).strip()
            if not title:
                continue
            key = title.casefold()

            preps = act.get("required_preparations") or []
            if isinstance(preps, str):
                preps = [preps]
            elif not isinstance(preps, list):
                preps = []

            if key not in actions_map:
                actions_map[key] = {
                    "type": act.get("type", "khac"),
                    "title": title,
                    "deadline": str(act.get("deadline", "")).strip(),
                    "required_preparations": list(OrderedDict.fromkeys(p.strip() for p in preps if p and str(p).strip())),
                    "priority": act.get("priority", "normal"),
                    "completed": bool(act.get("completed", False)),
                }
            else:
                existing = actions_map[key]
                # Merge preparations
                combined_preps = existing["required_preparations"] + [p.strip() for p in preps if p and str(p).strip()]
                existing["required_preparations"] = list(OrderedDict.fromkeys(combined_preps))
                # Update deadline if newer exists
                if act.get("deadline"):
                    existing["deadline"] = str(act["deadline"]).strip()
                # If either is completed, keep completed
                if act.get("completed"):
                    existing["completed"] = True
                if act.get("priority") == "high":
                    existing["priority"] = "high"

    return list(actions_map.values())


def merge_schedule_items(messages: List[MailDigest]) -> List[Dict[str, Any]]:
    """Merge schedule items from all messages in the thread, deduplicating by work_item_id."""
    seen_ids = set()
    result = []
    for msg in messages:
        items = msg.schedule_items or []
        if not isinstance(items, list):
            continue
        for it in items:
            if not isinstance(it, dict):
                continue
            wid = it.get("work_item_id")
            if wid and wid in seen_ids:
                continue
            if wid:
                seen_ids.add(wid)
            result.append(it)
    return result


def build_thread_summary(messages: List[MailDigest]) -> str:
    """
    Build a unified summary for the entire thread from real AI summaries.
    NOTE: When AI summary is not yet available, returns empty string so that
    frontend displays Gmail snippet + 'Chưa phân tích bằng AI' banner instead
    of repeating email subjects as fake summaries.
    """
    if not messages:
        return ""

    sorted_msgs = sorted(messages, key=lambda m: m.received_at)
    latest = sorted_msgs[-1]

    # If any message has a real AI summary, return it
    if latest.summary and not latest.summary.startswith("Luồng trao đổi ("):
        return latest.summary.strip()

    for m in reversed(sorted_msgs):
        if m.summary and not m.summary.startswith("Luồng trao đổi ("):
            return m.summary.strip()

    return ""


def aggregate_thread(thread_key: str, messages: List[MailDigest], user_email: str = "") -> Dict[str, Any]:
    """
    Aggregate a group of messages into a single thread card representation.
    """
    sorted_msgs = sorted(messages, key=lambda m: m.received_at)
    latest = sorted_msgs[-1]
    first = sorted_msgs[0]

    needs_reply, match_reason = calculate_thread_needs_reply(sorted_msgs)

    # Participants list deduplicated by email
    participants_map: Dict[str, str] = OrderedDict()
    for m in sorted_msgs:
        em = (m.sender_email or "").strip().lower()
        nm = m.sender.split("<")[0].strip() or em
        if em:
            if em not in participants_map:
                participants_map[em] = nm
        elif nm:
            participants_map[nm] = nm

    participants = [{"email": em, "name": nm} for em, nm in participants_map.items()]

    # Recipient role: TO if any is TO; else CC if any is CC; else OTHER
    if any(m.recipient_role == MailDigest.RECIPIENT_ROLE_TO for m in sorted_msgs):
        recipient_role = MailDigest.RECIPIENT_ROLE_TO
    elif any(m.recipient_role == MailDigest.RECIPIENT_ROLE_CC for m in sorted_msgs):
        recipient_role = MailDigest.RECIPIENT_ROLE_CC
    else:
        recipient_role = MailDigest.RECIPIENT_ROLE_OTHER

    addressed_by_name = any(m.addressed_by_name for m in sorted_msgs)

    # Priority: High if any unanswered high priority, else latest
    has_high = any(m.priority == MailDigest.PRIORITY_HIGH for m in sorted_msgs if not m.is_from_me)
    priority = MailDigest.PRIORITY_HIGH if has_high else MailDigest.PRIORITY_NORMAL

    # Actions and schedule items
    actions = merge_thread_actions(sorted_msgs)
    schedule_items = merge_schedule_items(sorted_msgs)

    # Thread-level summary lookup from MailThreadSummary
    thread_id = latest.thread_id or (first.thread_id or "")
    thread_summary_obj = None
    if thread_id and hasattr(latest, "user") and latest.user:
        try:
            from .models import MailThreadSummary
            thread_summary_obj = MailThreadSummary.objects.filter(
                user=latest.user,
                thread_id=thread_id,
            ).first()
        except Exception:
            pass

    has_ai_summary = False
    waiting_for = ""
    thread_error = ""
    last_analyzed_at = None

    if thread_summary_obj and thread_summary_obj.summary:
        summary = thread_summary_obj.summary.strip()
        waiting_for = thread_summary_obj.waiting_for.strip()
        has_ai_summary = True
        thread_error = thread_summary_obj.error_message or ""
        if thread_summary_obj.last_analyzed_at:
            last_analyzed_at = thread_summary_obj.last_analyzed_at.isoformat()
        if thread_summary_obj.actions:
            # Combine actions and deduplicate
            pseudo_digest = MailDigest(actions=thread_summary_obj.actions)
            actions = merge_thread_actions([pseudo_digest] + sorted_msgs)
    else:
        # Fallback to single-digest AI summary if exists and not repeating headers
        raw_sum = build_thread_summary(sorted_msgs)
        if raw_sum:
            summary = raw_sum
            has_ai_summary = True
        else:
            summary = ""
            has_ai_summary = False
        if thread_summary_obj:
            thread_error = thread_summary_obj.error_message or ""

    # Status: handled (replied/ignored) if latest is handled or all are handled
    if latest.status == MailDigest.STATUS_REPLIED or all(m.status == MailDigest.STATUS_REPLIED for m in sorted_msgs):
        status = MailDigest.STATUS_REPLIED
    elif latest.status == MailDigest.STATUS_IGNORED:
        status = MailDigest.STATUS_IGNORED
    else:
        status = MailDigest.STATUS_NEW

    # Timeline messages
    timeline = []
    for m in sorted_msgs:
        timeline.append({
            "id": m.id,
            "message_id": m.message_id,
            "sender": m.sender,
            "sender_email": m.sender_email,
            "received_at": m.received_at.isoformat(),
            "recipient_role": m.recipient_role,
            "addressed_by_name": m.addressed_by_name,
            "is_from_me": m.is_from_me,
            "snippet": m.snippet or "",
            "summary": m.summary if (m.summary and not m.summary.startswith("Luồng trao đổi (")) else "",
            "needs_reply": m.needs_reply,
            "status": m.status,
        })

    # Reply by deadline
    reply_by = (thread_summary_obj.reply_by if thread_summary_obj and thread_summary_obj.reply_by else "") or latest.reply_by or ""
    if not reply_by:
        for m in reversed(sorted_msgs):
            if m.reply_by:
                reply_by = m.reply_by
                break

    return {
        "id": latest.id,
        "thread_id": thread_id,
        "message_id": latest.message_id,
        "subject": latest.subject,
        "clean_subject": clean_subject(latest.subject),
        "sender": latest.sender,
        "sender_email": latest.sender_email,
        "received_at": latest.received_at.isoformat(),
        "received_at_dt": latest.received_at,
        "messages_count": len(sorted_msgs),
        "participants": participants,
        "recipient_role": recipient_role,
        "addressed_by_name": addressed_by_name,
        "match_reason": match_reason or latest.match_reason,
        "priority": priority,
        "needs_reply": needs_reply,
        "reply_by": reply_by,
        "summary": summary,
        "has_ai_summary": has_ai_summary,
        "waiting_for": waiting_for,
        "latest_snippet": latest.snippet or "",
        "thread_error": thread_error,
        "last_analyzed_at": last_analyzed_at,
        "actions": actions,
        "schedule_items": schedule_items,
        "status": status,
        "is_from_me": latest.is_from_me,
        "messages": timeline,
    }


def group_digests_into_threads(queryset, user_email: str = "") -> List[Dict[str, Any]]:
    """
    Given a MailDigest queryset or list of digests, group them by thread_id or subject,
    aggregate each group into a single thread card, and return the aggregated list.
    """
    groups: Dict[str, List[MailDigest]] = OrderedDict()

    # Pre-sort queryset by received_at ascending
    if hasattr(queryset, "order_by"):
        digests = list(queryset.order_by("received_at"))
    else:
        digests = sorted(queryset, key=lambda d: d.received_at)

    for d in digests:
        key = get_thread_key(d)
        if key not in groups:
            groups[key] = []
        groups[key].append(d)

    threads = []
    for key, msgs in groups.items():
        thread_data = aggregate_thread(key, msgs, user_email=user_email)
        threads.append(thread_data)

    return threads
