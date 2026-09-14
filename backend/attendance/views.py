import re
import unicodedata
from datetime import date, datetime, time, timedelta

from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.models import UserProfile
from authentication.permissions import IsAuthenticated

from .models import AttendanceRecord, TimesheetEditLog, TimesheetEntry


# ---------------------------------------------------------------------------
# Legacy shift config (kept for backward compat with old endpoints)
# ---------------------------------------------------------------------------
SHIFTS = {
    "OFFICE": {"name": "Ca hành chính", "start": time(8, 0), "end": time(17, 30), "expected": 480},
    "MORNING": {"name": "Ca sáng", "start": time(8, 0), "end": time(12, 0), "expected": 240},
    "AFTERNOON": {"name": "Ca chiều", "start": time(13, 30), "end": time(17, 30), "expected": 240},
    "EVENING": {"name": "Ca tối", "start": time(18, 0), "end": time(22, 0), "expected": 240},
}

ACCOUNTING_DEPT_NAMES = {"kế toán", "ke toan", "accounting"}
TRAINING_DEPT_NAMES = {"đào tạo số", "dao tao so", "phòng đào tạo số", "phong dao tao so", "digital training"}
FIXED_HOLIDAYS = {(1, 1), (4, 30), (5, 1), (9, 2)}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _local(value):
    return timezone.localtime(value) if value else None


def _is_default_day_off(value):
    return value.weekday() >= 5 or (value.month, value.day) in FIXED_HOLIDAYS


def _required_timesheet_dates(profiles, start, end):
    """Weekend dates that become working days because of their work schedule."""
    from work_schedule.models import WorkItem

    emails = [profile.email for profile in profiles]
    result = {email: set() for email in emails}
    if not emails:
        return result
    rows = WorkItem.objects.filter(
        executor_id__in=emails,
        work_date__gte=start,
        work_date__lt=end,
    ).values("executor_id", "work_date").annotate(
        item_count=Count("id"),
        training_count=Count("id", filter=Q(training_session__isnull=False)),
    )
    for row in rows:
        work_date = row["work_date"]
        if (
            work_date.weekday() >= 5
            and (work_date.month, work_date.day) not in FIXED_HOLIDAYS
            and (row["item_count"] >= 3 or row["training_count"] > 0)
        ):
            result[row["executor_id"]].add(work_date)
    return result


def _normalized_label(value):
    text = unicodedata.normalize("NFD", str(value or "").strip().lower().replace("đ", "d"))
    return " ".join("".join(char for char in text if unicodedata.category(char) != "Mn").split())


def _profile_department_names(profile):
    names = set()
    if profile.department:
        names.add(_normalized_label(profile.department.name))
    names.update(_normalized_label(item.name) for item in profile.departments.all())
    return names


def _can_show_training_summary(profile):
    departments = _profile_department_names(profile)
    accounting = {_normalized_label(value) for value in ACCOUNTING_DEPT_NAMES}
    training = {_normalized_label(value) for value in TRAINING_DEPT_NAMES}
    if departments.intersection(accounting) or any("ke toan" in name for name in departments):
        return False
    belongs_to_training = bool(departments.intersection(training)) or any("dao tao so" in name for name in departments)
    return str(profile.role).upper() == "ADMIN" or belongs_to_training


def _training_session_counts(profiles, start, end):
    """Count Digital Training sessions by the explicit instructor/support fields.

    Only sessions that already took place are counted: the range stops at the end
    of yesterday, so a session scheduled for today or any future date is ignored
    even when the instructor/support staff are already named on it.
    """
    from digital_training.models import TrainingSession

    profiles = list(profiles)
    if not profiles:
        return {}
    counted_end = min(end, _summary_cutoff_exclusive())
    if counted_end <= start:
        return {profile.email: {"instructorSessions": 0, "supportSessions": 0} for profile in profiles}
    sessions = list(
        TrainingSession.objects.filter(session_date__gte=start, session_date__lt=counted_end)
        .exclude(status__in=["cancelled", "unscheduled"])
        .values("instructor_name", "support_staff_name")
    )

    def staff_tokens(value):
        return {
            _normalized_label(part)
            for part in re.split(r"[,;\n]+", str(value or ""))
            if _normalized_label(part)
        }

    parsed = [(staff_tokens(row["instructor_name"]), staff_tokens(row["support_staff_name"])) for row in sessions]
    result = {}
    for profile in profiles:
        identities = {_normalized_label(profile.name), _normalized_label(profile.email)} - {""}
        result[profile.email] = {
            "instructorSessions": sum(1 for instructors, _ in parsed if identities.intersection(instructors)),
            "supportSessions": sum(1 for _, supporters in parsed if identities.intersection(supporters)),
        }
    return result


def _summary_cutoff_exclusive():
    """Summaries stop at the end of yesterday, so today is never half-counted."""
    return timezone.localdate()


def _month_range(value):
    try:
        start = datetime.strptime(value, "%Y-%m").date().replace(day=1)
    except (TypeError, ValueError):
        start = timezone.localdate().replace(day=1)
    next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start, next_month


def _parse_time(raw):
    raw = str(raw or "").strip()
    if not raw:
        return None
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(raw, fmt).time()
        except ValueError:
            continue
    return None


def _is_privileged(request):
    """Admin or accounting department (incl. probation) → full access."""
    role = getattr(request, "user_role", "EMPLOYEE")
    if role == "ADMIN":
        return True
    user = request.user
    # Check primary department
    dept = getattr(user, "department", None)
    if dept and dept.name.lower().strip() in ACCOUNTING_DEPT_NAMES:
        return True
    # Check secondary departments (ManyToMany)
    if hasattr(user, "departments"):
        for d in user.departments.all():
            if d.name.lower().strip() in ACCOUNTING_DEPT_NAMES:
                return True
    return False


def _can_edit_date(request, work_date):
    """Past and current dates are editable; future attendance is never writable."""
    return work_date <= timezone.localdate()


# ---------------------------------------------------------------------------
# Timesheet entry payload
# ---------------------------------------------------------------------------
def _entry_payload(entry, include_employee=False):
    payload = {
        "id": entry.id,
        "workDate": entry.work_date.isoformat(),
        "shiftNumber": entry.shift_number,
        "shiftStart": entry.shift_start.isoformat(timespec="minutes"),
        "shiftEnd": entry.shift_end.isoformat(timespec="minutes"),
        "crossesMidnight": entry.crosses_midnight,
        "workMode": entry.work_mode,
        "isDayOff": entry.is_day_off,
        "notes": entry.notes,
        "workedMinutes": entry.worked_minutes,
    }
    if include_employee:
        payload["employee"] = {
            "email": entry.employee_id,
            "name": entry.employee.name or entry.employee_id,
            "department": entry.employee.department.name if entry.employee.department else "",
        }
    return payload


def _log_payload(log):
    return {
        "id": log.id,
        "employeeEmail": log.employee_id,
        "employeeName": log.employee.name if log.employee else log.employee_id,
        "workDate": log.work_date.isoformat(),
        "editedBy": log.edited_by_id,
        "editedByName": log.edited_by.name if log.edited_by else log.edited_by_id,
        "note": log.note,
        "oldData": log.old_data,
        "newData": log.new_data,
        "createdAt": log.created_at.isoformat(),
    }


def _snapshot_entries(entries):
    """Serialize entries to JSON-safe dict for edit log."""
    return [
        {
            "shift": e.shift_number,
            "start": e.shift_start.isoformat(timespec="minutes"),
            "end": e.shift_end.isoformat(timespec="minutes"),
            "mode": e.work_mode,
            "dayOff": e.is_day_off,
            "notes": e.notes,
        }
        for e in entries
    ]


def _schedule_signature(snapshot):
    """Compare only the working-time plan, not mode or free-form notes."""
    return [
        (bool(shift.get("dayOff")), str(shift.get("start") or ""), str(shift.get("end") or ""))
        for shift in snapshot
    ]


# ---------------------------------------------------------------------------
# Auto-purge: keep only current + previous month
# ---------------------------------------------------------------------------
def _purge_old_entries():
    today = timezone.localdate()
    first_of_month = today.replace(day=1)
    first_of_prev = (first_of_month - timedelta(days=1)).replace(day=1)
    TimesheetEntry.objects.filter(work_date__lt=first_of_prev).delete()
    TimesheetEditLog.objects.filter(work_date__lt=first_of_prev).delete()


# ---------------------------------------------------------------------------
# Timesheet endpoints
# ---------------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def timesheet_list(request):
    """Return timesheet entries for a month, with summary stats."""
    _purge_old_entries()

    start, end = _month_range(request.query_params.get("month"))
    privileged = _is_privileged(request)

    scope = str(request.query_params.get("scope") or "mine").lower()
    queryset = TimesheetEntry.objects.select_related("employee", "employee__department").filter(
        work_date__gte=start, work_date__lt=end,
    )

    if scope == "all" and privileged:
        pass  # see all
    else:
        queryset = queryset.filter(employee=request.user)
        scope = "mine"

    entries = list(queryset.order_by("-work_date", "shift_number")[:2000])
    own_entries = [e for e in entries if e.employee_id == request.user.email] if scope != "mine" else entries

    # Summaries only cover completed days: everything up to the end of yesterday.
    cutoff = _summary_cutoff_exclusive()
    counted = [e for e in own_entries if e.work_date < cutoff and not e.is_day_off]
    total_minutes = sum(e.worked_minutes for e in counted)
    online_minutes = sum(e.worked_minutes for e in counted if e.work_mode == "online")
    offline_minutes = sum(e.worked_minutes for e in counted if e.work_mode == "direct")
    summary_cutoff = min(cutoff, end) - timedelta(days=1)

    # Edit logs for this month
    log_qs = TimesheetEditLog.objects.select_related("employee", "edited_by").filter(
        work_date__gte=start, work_date__lt=end,
    )
    if scope == "mine":
        log_qs = log_qs.filter(employee=request.user)
    logs = list(log_qs.order_by("-created_at")[:200])

    # Employee list for privileged users
    employees = []
    if scope == "all" and privileged:
        all_employees = UserProfile.objects.filter(
            employment_status="ACTIVE",
        ).select_related("department").prefetch_related("departments").order_by("name")
        employees = [
            {
                "email": emp.email,
                "name": emp.name or emp.email,
                "department": emp.department.name if emp.department else "",
            }
            for emp in all_employees
        ]

    summary_profiles = list(all_employees) if scope == "all" and privileged else [request.user]
    training_summary = _training_session_counts(summary_profiles, start, end) if _can_show_training_summary(request.user) else {}
    required_dates = _required_timesheet_dates(summary_profiles, start, end)

    return Response({
        "serverTime": _local(timezone.now()).isoformat(),
        "scope": scope,
        "month": start.strftime("%Y-%m"),
        "isPrivileged": privileged,
        "isAdmin": getattr(request, "user_role", "EMPLOYEE") == "ADMIN",
        "summaryCutoff": summary_cutoff.isoformat(),
        "entries": [_entry_payload(e, include_employee=(scope != "mine")) for e in entries],
        "summary": {
            "totalMinutes": total_minutes,
            "onlineMinutes": online_minutes,
            "offlineMinutes": offline_minutes,
        },
        "editLogs": [_log_payload(lg) for lg in logs],
        "employees": employees,
        "trainingSummaryByEmployee": training_summary,
        "requiredTimesheetDatesByEmployee": {
            email: [work_date.isoformat() for work_date in sorted(dates)]
            for email, dates in required_dates.items()
        },
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def timesheet_save(request):
    """Save (replace) all shifts for a single day."""
    raw_date = str(request.data.get("workDate") or "").strip()
    try:
        work_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return Response({"error": "Ngày không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)

    if work_date > timezone.localdate():
        return Response(
            {"error": "Không thể cập nhật công ca cho ngày trong tương lai."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Determine target employee (privileged users can edit others)
    target_email = str(request.data.get("employeeEmail") or "").strip()
    privileged = _is_privileged(request)
    if target_email and privileged:
        try:
            target_user = UserProfile.objects.get(email=target_email)
        except UserProfile.DoesNotExist:
            return Response({"error": "Nhân viên không tồn tại."}, status=status.HTTP_404_NOT_FOUND)
    else:
        target_user = request.user

    # Permission check
    if not _can_edit_date(request, work_date):
        return Response(
            {"error": "Bạn không có quyền chỉnh sửa ngày này. Hãy liên hệ kế toán nếu muốn chỉnh sửa giờ làm."},
            status=status.HTTP_403_FORBIDDEN,
        )

    is_day_off = bool(request.data.get("isDayOff"))
    shifts = request.data.get("shifts") or []
    edit_note = str(request.data.get("editNote") or "").strip()

    if not is_day_off and not shifts:
        return Response({"error": "Vui lòng thêm ít nhất một ca hoặc đánh dấu nghỉ."}, status=status.HTTP_400_BAD_REQUEST)
    if not is_day_off and len(shifts) > 10:
        return Response({"error": "Tối đa 10 ca trong một ngày."}, status=status.HTTP_400_BAD_REQUEST)

    parsed_shifts = []
    if not is_day_off:
        for idx, shift in enumerate(shifts, start=1):
            start_time = _parse_time(shift.get("start"))
            end_time = _parse_time(shift.get("end"))
            if not start_time or not end_time:
                return Response({"error": f"Ca {idx}: giờ bắt đầu hoặc kết thúc không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
            if start_time == end_time:
                return Response({"error": f"Ca {idx}: giờ bắt đầu và kết thúc không được giống nhau."}, status=status.HTTP_400_BAD_REQUEST)
            work_mode = str(shift.get("workMode") or "direct").lower()
            if work_mode not in ("direct", "online"):
                work_mode = "direct"
            notes = str(shift.get("notes") or "").strip()[:500]
            parsed_shifts.append({
                "shift_number": idx,
                "shift_start": start_time,
                "shift_end": end_time,
                "work_mode": work_mode,
                "notes": notes,
            })

    with transaction.atomic():
        existing = list(
            TimesheetEntry.objects.filter(employee=target_user, work_date=work_date).order_by("shift_number")
        )
        is_edit = len(existing) > 0

        old_snapshot = _snapshot_entries(existing) if is_edit else []

        TimesheetEntry.objects.filter(employee=target_user, work_date=work_date).delete()
        if is_day_off:
            TimesheetEntry.objects.create(
                employee=target_user,
                work_date=work_date,
                shift_number=1,
                shift_start=time(0, 0),
                shift_end=time(0, 0),
                is_day_off=True,
            )
        else:
            for shift_data in parsed_shifts:
                TimesheetEntry.objects.create(
                    employee=target_user,
                    work_date=work_date,
                    **shift_data,
                )

        saved = list(
            TimesheetEntry.objects.filter(employee=target_user, work_date=work_date).order_by("shift_number")
        )

        new_snapshot = _snapshot_entries(saved)
        if is_edit and _schedule_signature(old_snapshot) != _schedule_signature(new_snapshot):
            TimesheetEditLog.objects.create(
                employee=target_user,
                work_date=work_date,
                edited_by=request.user,
                note=edit_note[:1000],
                old_data={"shifts": old_snapshot},
                new_data={"shifts": new_snapshot},
            )

    # Timesheet changes are web-authoritative for the visible "Chấm công"
    # column. Queue the existing background Sheet worker after the DB commit.
    from work_schedule.signals import queue_group
    queue_group(target_user.email, work_date)

    return Response({
        "message": "Đã lưu công ca." if not is_day_off else "Đã ghi nhận nghỉ làm.",
        "entries": [_entry_payload(e) for e in saved],
    })


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def timesheet_log_delete(request, log_id):
    """Remove one note from the timesheet table. Administrators only."""
    if getattr(request, "user_role", "EMPLOYEE") != "ADMIN":
        return Response({"error": "Chỉ quản trị viên mới được xóa ghi chú."}, status=status.HTTP_403_FORBIDDEN)
    deleted, _ = TimesheetEditLog.objects.filter(pk=log_id).delete()
    if not deleted:
        return Response({"error": "Không tìm thấy ghi chú."}, status=status.HTTP_404_NOT_FOUND)
    return Response({"message": "Đã xóa ghi chú."})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def timesheet_prefill(request):
    """Return suggested shifts for the 'Add Timesheet' popup."""
    raw_date = request.query_params.get("date")
    today = timezone.localdate()
    now_local = _local(timezone.now())

    if raw_date:
        try:
            target_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
        except (TypeError, ValueError):
            target_date = today
    else:
        target_date = today

    # Determine target employee
    target_email = request.query_params.get("employee")
    privileged = _is_privileged(request)
    if target_email and privileged:
        try:
            target_user = UserProfile.objects.get(email=target_email)
        except UserProfile.DoesNotExist:
            target_user = request.user
    else:
        target_user = request.user

    yesterday = today - timedelta(days=1)
    yesterday_filled = TimesheetEntry.objects.filter(employee=target_user, work_date=yesterday).exists()
    target_filled = TimesheetEntry.objects.filter(employee=target_user, work_date=target_date).exists()

    existing = list(
        TimesheetEntry.objects.filter(employee=target_user, work_date=target_date).order_by("shift_number")
    )

    is_weekend = target_date.weekday() >= 5
    required_dates = _required_timesheet_dates(
        [target_user], min(target_date, yesterday), max(target_date, yesterday) + timedelta(days=1)
    )[target_user.email]
    default_day_off = _is_default_day_off(target_date) and target_date not in required_dates
    default_mode = "online" if is_weekend else "direct"

    # Auto-fill logic:
    # After 16:00 today + yesterday done → 2 shifts
    # 7:00-15:59 today → 1 shift (morning only)
    # Filling for a past date → 2 shifts
    suggested_shifts = []
    if not target_filled and not existing and not default_day_off:
        if target_date == today:
            if now_local.hour >= 16 and yesterday_filled:
                suggested_shifts = [
                    {"start": "08:00", "end": "12:00", "workMode": default_mode, "notes": ""},
                    {"start": "13:30", "end": "17:30", "workMode": default_mode, "notes": ""},
                ]
            elif 7 <= now_local.hour < 16:
                suggested_shifts = [
                    {"start": "08:00", "end": "12:00", "workMode": default_mode, "notes": ""},
                ]
            else:
                suggested_shifts = [
                    {"start": "08:00", "end": "12:00", "workMode": default_mode, "notes": ""},
                ]
        else:
            # Past date → suggest 2 shifts
            suggested_shifts = [
                {"start": "08:00", "end": "12:00", "workMode": default_mode, "notes": ""},
                {"start": "13:30", "end": "17:30", "workMode": default_mode, "notes": ""},
            ]

    # Weekend days with 3+ tasks or a training session are working days. The
    # same rule drives both this warning and the default checkbox in the UI.
    yesterday_warning = False
    if target_date == today and not yesterday_filled:
        yesterday_is_day_off = _is_default_day_off(yesterday) and yesterday not in required_dates
        yesterday_warning = not yesterday_is_day_off

    # Edit logs for this date
    edit_logs = list(
        TimesheetEditLog.objects.select_related("employee", "edited_by").filter(
            employee=target_user, work_date=target_date,
        ).order_by("-created_at")[:50]
    )

    return Response({
        "targetDate": target_date.isoformat(),
        "autoFill": len(suggested_shifts) > 0 and not existing,
        "shifts": suggested_shifts,
        "yesterdayWarning": yesterday_warning,
        "yesterdayDate": yesterday.isoformat(),
        "defaultWorkMode": default_mode,
        "defaultDayOff": default_day_off,
        "existing": [_entry_payload(e) for e in existing],
        "canEdit": _can_edit_date(request, target_date),
        "isPrivileged": privileged,
        "editLogs": [_log_payload(lg) for lg in edit_logs],
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def timesheet_range(request):
    """Return timesheet entries for a date range, grouped by date.
    Used by the WorkSchedule grid to populate the Chấm công column."""
    raw_start = request.query_params.get("start")
    raw_end = request.query_params.get("end")
    try:
        start_date = datetime.strptime(raw_start, "%Y-%m-%d").date()
        end_date = datetime.strptime(raw_end, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return Response({"error": "Ngày không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)

    entries = list(
        TimesheetEntry.objects.filter(
            employee=request.user,
            work_date__gte=start_date,
            work_date__lte=end_date,
        ).order_by("work_date", "shift_number")
    )

    by_date = {}
    for e in entries:
        key = e.work_date.isoformat()
        by_date.setdefault(key, []).append({
            "shiftStart": e.shift_start.isoformat(timespec="minutes"),
            "shiftEnd": e.shift_end.isoformat(timespec="minutes"),
            "workMode": e.work_mode,
            "isDayOff": e.is_day_off,
        })

    return Response({"dates": by_date})


# ---------------------------------------------------------------------------
# Legacy endpoints (kept for backward compatibility)
# ---------------------------------------------------------------------------
def _client_ip(request):
    forwarded = str(request.META.get("HTTP_X_FORWARDED_FOR") or "")
    return (forwarded.split(",", 1)[0].strip() or str(request.META.get("REMOTE_ADDR") or ""))[:64]


def _worked_minutes(item, until=None):
    end = item.clock_out or until
    if not end:
        return 0
    start_local = _local(item.clock_in)
    end_local = _local(end)
    minutes = max(0, int((end_local - start_local).total_seconds() // 60))
    if item.shift_code == "OFFICE":
        break_start = timezone.make_aware(datetime.combine(item.work_date, time(12, 0)))
        break_end = timezone.make_aware(datetime.combine(item.work_date, time(13, 30)))
        overlap = max(timedelta(0), min(end_local, break_end) - max(start_local, break_start))
        minutes = max(0, minutes - int(overlap.total_seconds() // 60))
    return minutes


def _record_status(item, worked_minutes):
    if item.clock_out is None:
        return "WORKING"
    local_in = _local(item.clock_in)
    scheduled = timezone.make_aware(datetime.combine(item.work_date, item.scheduled_start))
    if local_in > scheduled + timedelta(minutes=15):
        return "LATE"
    if worked_minutes < max(0, item.expected_minutes - 15):
        return "INCOMPLETE"
    return "COMPLETE"


def _record_payload(item, now=None):
    worked = _worked_minutes(item, until=now)
    return {
        "id": item.id,
        "employee": {
            "email": item.employee_id,
            "name": item.employee.name or item.employee_id,
            "employeeCode": item.employee.employee_code or "",
            "department": item.employee.department.name if item.employee.department else "",
        },
        "workDate": item.work_date.isoformat(),
        "shiftCode": item.shift_code,
        "shiftName": item.shift_name,
        "scheduledStart": item.scheduled_start.isoformat(timespec="minutes"),
        "scheduledEnd": item.scheduled_end.isoformat(timespec="minutes"),
        "expectedMinutes": item.expected_minutes,
        "clockIn": _local(item.clock_in).isoformat(),
        "clockOut": _local(item.clock_out).isoformat() if item.clock_out else None,
        "workedMinutes": worked,
        "status": _record_status(item, worked),
        "note": item.note,
    }


def _records_for_request(request, start, end):
    queryset = AttendanceRecord.objects.select_related("employee", "employee__department").filter(work_date__gte=start, work_date__lt=end)
    scope = str(request.query_params.get("scope") or "mine").lower()
    role = getattr(request, "user_role", "EMPLOYEE")
    if scope == "team" and role == "ADMIN":
        return queryset, "team"
    if scope == "team" and role == "MANAGER":
        emails = UserProfile.objects.filter(manager_id=request.user.email).values_list("email", flat=True)
        return queryset.filter(employee_id__in=list(emails) + [request.user.email]), "team"
    return queryset.filter(employee=request.user), "mine"


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def attendance_records(request):
    start, end = _month_range(request.query_params.get("month"))
    queryset, scope = _records_for_request(request, start, end)
    now = timezone.now()
    rows = list(queryset.order_by("-work_date", "-clock_in")[:500])
    payloads = [_record_payload(item, now=now) for item in rows]
    mine_open = AttendanceRecord.objects.select_related("employee", "employee__department").filter(employee=request.user, clock_out__isnull=True).order_by("-clock_in").first()
    own_rows = [item for item in rows if item.employee_id == request.user.email] if scope == "team" else rows
    closed_minutes = sum(_worked_minutes(item) for item in own_rows if item.clock_out)
    return Response({
        "serverTime": _local(now).isoformat(),
        "scope": scope,
        "month": start.strftime("%Y-%m"),
        "shifts": [{"code": code, "name": shift["name"], "start": shift["start"].isoformat(timespec="minutes"), "end": shift["end"].isoformat(timespec="minutes"), "expectedMinutes": shift["expected"]} for code, shift in SHIFTS.items()],
        "current": _record_payload(mine_open, now=now) if mine_open else None,
        "records": payloads,
        "summary": {
            "workDays": len({item.work_date for item in own_rows}),
            "totalMinutes": closed_minutes,
            "completedShifts": sum(1 for item in own_rows if item.clock_out),
            "lateShifts": sum(1 for item in own_rows if item.clock_out and _record_status(item, _worked_minutes(item)) == "LATE"),
        },
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def attendance_clock(request):
    action = str(request.data.get("action") or "").upper()
    now = timezone.now()
    if action not in {"IN", "OUT"}:
        return Response({"error": "Thao tác chấm công không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        open_record = AttendanceRecord.objects.select_for_update().filter(employee=request.user, clock_out__isnull=True).order_by("-clock_in").first()
        if action == "OUT":
            if not open_record:
                return Response({"error": "Bạn chưa có ca làm việc đang mở."}, status=status.HTTP_400_BAD_REQUEST)
            open_record.clock_out = now
            open_record.clock_out_ip = _client_ip(request)
            open_record.save(update_fields=["clock_out", "clock_out_ip", "updated_at"])
            open_record = AttendanceRecord.objects.select_related("employee", "employee__department").get(pk=open_record.pk)
            return Response({"message": "Đã ghi nhận giờ ra ca.", "record": _record_payload(open_record)})

        if open_record:
            return Response({"error": f"Bạn đang trong {open_record.shift_name}. Hãy chấm ra trước khi vào ca mới."}, status=status.HTTP_400_BAD_REQUEST)
        shift_code = str(request.data.get("shiftCode") or "OFFICE").upper()
        shift = SHIFTS.get(shift_code)
        if not shift:
            return Response({"error": "Ca làm việc không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
        work_date = timezone.localdate(now)
        try:
            item = AttendanceRecord.objects.create(
                employee=request.user,
                work_date=work_date,
                shift_code=shift_code,
                shift_name=shift["name"],
                scheduled_start=shift["start"],
                scheduled_end=shift["end"],
                expected_minutes=shift["expected"],
                clock_in=now,
                note=str(request.data.get("note") or "").strip()[:500],
                clock_in_ip=_client_ip(request),
            )
        except IntegrityError:
            return Response({"error": "Ca này đã được chấm công trong hôm nay."}, status=status.HTTP_400_BAD_REQUEST)
        item = AttendanceRecord.objects.select_related("employee", "employee__department").get(pk=item.pk)
        return Response({"message": "Đã ghi nhận giờ vào ca.", "record": _record_payload(item)}, status=status.HTTP_201_CREATED)
