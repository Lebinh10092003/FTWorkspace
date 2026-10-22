import re
import unicodedata
from datetime import date, time

from django.utils import timezone

from authentication.models import UserProfile
from authentication.notifications import notify_workspace


def _normalise(value):
    plain = "".join(
        char
        for char in unicodedata.normalize("NFD", str(value or "").lower())
        if unicodedata.category(char) != "Mn"
    ).replace("đ", "d")
    return re.sub(r"\s+", " ", plain).strip()


def _names(value):
    return [part.strip() for part in str(value or "").split(",") if part.strip()]


def _emails(*values):
    requested = {_normalise(name) for value in values for name in _names(value)}
    if not requested:
        return []
    matches = []
    for profile in UserProfile.objects.filter(employment_status="ACTIVE"):
        if _normalise(profile.name) in requested or _normalise(profile.email) in requested:
            matches.append(profile.email.lower())
    return sorted(set(matches))


def _parse_date(value):
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


def _parse_time(value):
    if isinstance(value, time):
        return value.replace(tzinfo=None)
    try:
        return time.fromisoformat(str(value or "")[:8]).replace(tzinfo=None)
    except ValueError:
        return None


def _is_future(payload):
    session_date = _parse_date(payload.get("date"))
    if not session_date:
        return False
    today = timezone.localdate()
    if session_date != today:
        return session_date > today
    start = _parse_time(payload.get("start_time"))
    return start is None or start > timezone.localtime().time().replace(tzinfo=None)


def _session_label(payload):
    number = payload.get("session_number")
    title = f"Buổi {number}" if number else str(payload.get("title") or "Buổi tập huấn")
    partner = str(payload.get("partner_name") or payload.get("partner") or "").strip()
    class_name = str(payload.get("class_group_name") or "").strip()
    return ", ".join(part for part in (title, partner, class_name) if part)


def _clock(value):
    parsed = _parse_time(value)
    return parsed.strftime("%H:%M") if parsed else "chưa đặt giờ"


def _schedule(payload):
    session_date = _parse_date(payload.get("date"))
    day = session_date.strftime("%d/%m/%Y") if session_date else "chưa đặt ngày"
    return f"{day}, {_clock(payload.get('start_time'))}–{_clock(payload.get('end_time'))}"


def _staff_summary(payload):
    instructor = str(payload.get("instructor_name") or "Chưa phân công")
    support = str(payload.get("support_staff_name") or "Chưa phân công")
    return f"Giảng viên: {instructor}. Nhân viên hỗ trợ: {support}."


def _staff_change(before, after):
    old_instructor = str(before.get("instructor_name") or "Chưa phân công")
    new_instructor = str(after.get("instructor_name") or "Chưa phân công")
    old_support = str(before.get("support_staff_name") or "Chưa phân công")
    new_support = str(after.get("support_staff_name") or "Chưa phân công")
    return f"Giảng viên: {old_instructor} → {new_instructor}. Nhân viên hỗ trợ: {old_support} → {new_support}."


def _event_stamp(payload):
    return str(payload.get("updated_at") or timezone.now().isoformat())


def _send(payload, event, title, message, emails, action_url=None, severity="info"):
    if not emails:
        return
    notify_workspace(
        event_key=f"training-session:{payload.get('id')}:{event}",
        title=title,
        message=message,
        severity=severity,
        category="digital-training",
        action_url=action_url or f"/digital-training/calendar/training/{payload.get('id')}",
        target_emails=emails,
    )


def notify_training_session_created(payload):
    if not _is_future(payload):
        return
    recipients = _emails(payload.get("instructor_name"), payload.get("support_staff_name"))
    label = _session_label(payload)
    _send(
        payload,
        "created",
        "Có lịch tập huấn mới",
        f"Lịch tập huấn {label} đã được thêm vào {_schedule(payload)}. {_staff_summary(payload)}",
        recipients,
    )


def notify_training_session_updated(before, after):
    if not _is_future(after):
        return
    recipients = _emails(
        before.get("instructor_name"),
        before.get("support_staff_name"),
        after.get("instructor_name"),
        after.get("support_staff_name"),
    )
    label = _session_label(after)
    time_fields = ("date", "start_time", "end_time")
    if any(before.get(field) != after.get(field) for field in time_fields):
        _send(
            after,
            "time-changed",
            "Thời gian tập huấn đã thay đổi",
            f"Lịch tập huấn {label} đã bị thay đổi từ {_schedule(before)} thành {_schedule(after)}.",
            recipients,
            severity="warning",
        )
    staff_fields = ("instructor_name", "support_staff_name")
    if any(before.get(field) != after.get(field) for field in staff_fields):
        _send(
            after,
            "staff-changed",
            "Phân công lịch tập huấn đã thay đổi",
            f"Lịch tập huấn {label} đã thay đổi nhân sự. {_staff_change(before, after)}",
            recipients,
            severity="warning",
        )
    identity_fields = ("title", "session_number", "partner_id", "partner_name", "class_group_id", "class_group_name")
    if any(before.get(field) != after.get(field) for field in identity_fields):
        _send(
            after,
            "details-changed",
            "Thông tin lịch tập huấn đã thay đổi",
            f"Lịch tập huấn {_session_label(before)} đã được cập nhật thành {label}.",
            recipients,
            severity="warning",
        )
    if before.get("location") != after.get("location"):
        old_location = str(before.get("location") or "chưa có địa điểm/link")
        new_location = str(after.get("location") or "chưa có địa điểm/link")
        _send(
            after,
            "location-changed",
            "Địa điểm tập huấn đã thay đổi",
            f"Lịch tập huấn {label} đã đổi địa điểm/link từ “{old_location}” thành “{new_location}”.",
            recipients,
            severity="warning",
        )
    if before.get("status") != after.get("status") and after.get("status") == "cancelled":
        _send(
            after,
            "cancelled",
            "Lịch tập huấn đã bị hủy",
            f"Lịch tập huấn {label}, dự kiến {_schedule(after)}, đã bị hủy.",
            recipients,
            severity="urgent",
        )


def notify_training_session_deleted(payload):
    if not _is_future(payload):
        return
    recipients = _emails(payload.get("instructor_name"), payload.get("support_staff_name"))
    _send(
        {**payload, "updated_at": timezone.now().isoformat()},
        "deleted",
        "Lịch tập huấn đã bị xóa",
        f"Lịch tập huấn {_session_label(payload)}, dự kiến {_schedule(payload)}, đã bị xóa.",
        recipients,
        action_url="/digital-training/calendar",
        severity="urgent",
    )
