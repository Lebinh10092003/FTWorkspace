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


@register_tool(
    name="attendance_export_monthly_report",
    description="Xuất (export) bảng tổng hợp chấm công tháng của nhân sự (hoặc toàn bộ nhân sự công ty nếu là Quản lý/Admin) ra CSV (UTF-8 BOM tải vào Excel) hoặc JSON.",
    module="attendance",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "month": {"type": "integer", "description": "Tháng cần xuất (1 - 12). Mặc định là tháng hiện tại."},
            "year": {"type": "integer", "description": "Năm cần xuất (ví dụ: 2026). Mặc định là năm hiện tại."},
            "staff_email": {
                "type": "string",
                "description": "Email nhân viên cần xuất (để trống sẽ xuất toàn bộ nhân sự nếu là Admin/Manager)",
            },
            "format": {
                "type": "string",
                "enum": ["csv", "json"],
                "description": "Định dạng xuất ('csv' hoặc 'json', mặc định 'json')",
            },
        },
        "additionalProperties": False,
    },
)
def attendance_export_monthly_report(
    ctx: Dict[str, Any],
    month: Optional[int] = None,
    year: Optional[int] = None,
    staff_email: Optional[str] = None,
    format: str = "json",
    **_kwargs,
) -> Dict[str, Any]:
    today = timezone.localdate()
    target_month = month or today.month
    target_year = year or today.year

    qs = AttendanceRecord.objects.select_related("employee").filter(
        work_date__year=target_year,
        work_date__month=target_month,
    )

    if staff_email and ctx["role"] in {"ADMIN", "MANAGER"}:
        qs = qs.filter(employee__email__iexact=staff_email.strip())
    elif ctx["role"] not in {"ADMIN", "MANAGER"}:
        qs = qs.filter(employee=ctx["profile"])

    items = []
    for rec in qs.order_by("employee__name", "work_date"):
        in_str = timezone.localtime(rec.clock_in).strftime("%H:%M:%S") if rec.clock_in else ""
        out_str = timezone.localtime(rec.clock_out).strftime("%H:%M:%S") if rec.clock_out else ""
        items.append({
            "employee_name": rec.employee.name if rec.employee else "",
            "employee_email": rec.employee.email if rec.employee else "",
            "work_date": rec.work_date.isoformat(),
            "shift_name": rec.shift_name,
            "clock_in": in_str,
            "clock_out": out_str,
            "note": rec.note or "",
        })

    if format == "csv":
        import csv
        import io
        out = io.StringIO()
        out.write("\ufeff")  # UTF-8 BOM
        writer = csv.writer(out)
        writer.writerow([
            "STT", "Họ và tên", "Email", "Ngày làm việc", "Ca làm việc",
            "Giờ vào (Clock In)", "Giờ ra (Clock Out)", "Ghi chú",
        ])
        for idx, it in enumerate(items, 1):
            writer.writerow([
                idx, it["employee_name"], it["employee_email"], it["work_date"],
                it["shift_name"], it["clock_in"], it["clock_out"], it["note"],
            ])
        return {
            "success": True,
            "format": "csv",
            "month": f"{target_month:02d}/{target_year}",
            "count": len(items),
            "csv_content": out.getvalue(),
        }

    return {
        "success": True,
        "format": "json",
        "month": f"{target_month:02d}/{target_year}",
        "count": len(items),
        "records": items,
    }

