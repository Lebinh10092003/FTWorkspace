from __future__ import annotations

from typing import Any, Dict, Optional
from django.utils import timezone

from attendance.models import AttendanceRecord, TimesheetEntry
from authentication.models import UserProfile
from .registry import register_tool


@register_tool(
    name="attendance_check_in_out",
    description="Thực hiện chấm công trực tiếp (Vào ca hoặc Ra ca) cho ngày làm việc hôm nay.",
    module="attendance",
    min_role="EMPLOYEE",
    audit_action="Chấm công vào/ra ca",
    parameters={
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["check_in", "check_out"],
                "description": "Hành động: 'check_in' (Vào ca) hoặc 'check_out' (Ra ca)",
            },
            "note": {"type": "string", "description": "Ghi chú chấm công (nếu có)"},
        },
        "required": ["action"],
        "additionalProperties": False,
    },
)
def attendance_check_in_out(ctx: Dict[str, Any], action: str, note: str = "", **_kwargs) -> Dict[str, Any]:
    profile: UserProfile = ctx["profile"]
    now = timezone.now()
    today = timezone.localdate()

    record = AttendanceRecord.objects.filter(employee=profile, work_date=today).first()

    if action == "check_in":
        if record and record.clock_in:
            return {
                "success": False,
                "error": f"Hôm nay bạn đã chấm công vào lúc {timezone.localtime(record.clock_in).strftime('%H:%M:%S')}.",
            }
        record = AttendanceRecord.objects.create(
            employee=profile,
            work_date=today,
            shift_code="HANH_CHINH",
            shift_name="Hành chính",
            scheduled_start=timezone.datetime.strptime("08:00", "%H:%M").time(),
            scheduled_end=timezone.datetime.strptime("17:30", "%H:%M").time(),
            clock_in=now,
            note=note,
        )
        return {
            "success": True,
            "message": f"Chấm công vào thành công lúc {timezone.localtime(now).strftime('%H:%M:%S')}.",
            "work_date": today.isoformat(),
        }

    # action == check_out
    if not record or not record.clock_in:
        return {
            "success": False,
            "error": "Bạn chưa chấm công vào hôm nay, không thể chấm công ra.",
        }
    if record.clock_out:
        return {
            "success": False,
            "error": f"Bạn đã chấm công ra lúc {timezone.localtime(record.clock_out).strftime('%H:%M:%S')}.",
        }

    record.clock_out = now
    if note:
        record.note = f"{record.note} | Ra ca: {note}".strip(" |")
    record.save(update_fields=["clock_out", "note", "updated_at"])

    return {
        "success": True,
        "message": f"Chấm công ra thành công lúc {timezone.localtime(now).strftime('%H:%M:%S')}.",
        "work_date": today.isoformat(),
    }


@register_tool(
    name="attendance_get_timesheet",
    description="Xem dữ liệu bảng chấm công cá nhân theo tháng (giờ vào, giờ ra, số phút làm việc).",
    module="attendance",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "month": {"type": "integer", "description": "Tháng cần xem (1 - 12). Mặc định là tháng hiện tại."},
            "year": {"type": "integer", "description": "Năm cần xem (ví dụ: 2026). Mặc định là năm hiện tại."},
            "staff_email": {
                "type": "string",
                "description": "Email nhân viên cần xem (nếu là Manager/Admin xem của nhân viên khác)",
            },
        },
        "additionalProperties": False,
    },
)
def attendance_get_timesheet(
    ctx: Dict[str, Any],
    month: Optional[int] = None,
    year: Optional[int] = None,
    staff_email: Optional[str] = None,
    **_kwargs,
) -> Dict[str, Any]:
    today = timezone.localdate()
    target_month = month or today.month
    target_year = year or today.year

    target_profile: UserProfile = ctx["profile"]
    if staff_email and ctx["role"] in {"ADMIN", "MANAGER"}:
        found = UserProfile.objects.filter(email__iexact=staff_email.strip()).first()
        if found:
            target_profile = found

    qs = AttendanceRecord.objects.filter(
        employee=target_profile,
        work_date__year=target_year,
        work_date__month=target_month,
    ).order_by("work_date")

    days_data = []
    total_days = qs.count()
    for rec in qs:
        clock_in_str = timezone.localtime(rec.clock_in).strftime("%H:%M") if rec.clock_in else ""
        clock_out_str = timezone.localtime(rec.clock_out).strftime("%H:%M") if rec.clock_out else ""
        days_data.append({
            "date": rec.work_date.isoformat(),
            "shift": rec.shift_name,
            "clock_in": clock_in_str,
            "clock_out": clock_out_str,
            "note": rec.note,
        })

    return {
        "employee_name": target_profile.name,
        "employee_email": target_profile.email,
        "month": f"{target_month:02d}/{target_year}",
        "worked_days": total_days,
        "records": days_data,
    }
