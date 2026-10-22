from __future__ import annotations

from typing import Any, Dict
from authentication.models import UserProfile, Department
from .registry import register_tool


@register_tool(
    name="system_whoami",
    description="Xem danh tính, vai trò, phòng ban và các phân hệ được phép thao tác của tài khoản đang kết nối.",
    module="system",
    min_role="VIEWER",
    parameters={
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
)
def system_whoami(ctx: Dict[str, Any], **_kwargs) -> Dict[str, Any]:
    profile: UserProfile = ctx["profile"]
    dept = getattr(profile, "department", None)
    job = getattr(profile, "job_title", None)
    return {
        "email": ctx["email"],
        "name": ctx["name"],
        "role": ctx["role"],
        "job_title": job.name if job else "",
        "department": dept.name if dept else "",
        "access_modules": list(ctx["access_modules"]),
        "is_admin": ctx["role"] == "ADMIN",
        "message": f"Bạn đang kết nối với tư cách {ctx['name']} ({ctx['role']}). Bạn có quyền trên {len(ctx['access_modules'])} phân hệ.",
    }


@register_tool(
    name="system_list_staff",
    description="Tra cứu danh bạ nhân sự nội bộ công ty (tìm theo tên, phòng ban, chức vụ hoặc email).",
    module="account-management",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Từ khóa tìm kiếm (tên, email, chức danh)",
            },
            "department": {
                "type": "string",
                "description": "Lọc theo tên phòng ban",
            },
        },
        "additionalProperties": False,
    },
)
def system_list_staff(ctx: Dict[str, Any], query: str = "", department: str = "", **_kwargs) -> Dict[str, Any]:
    qs = UserProfile.objects.select_related("department", "job_title").filter(is_active=True)
    if query:
        qs = qs.filter(name__icontains=query) | qs.filter(email__icontains=query)
    if department:
        qs = qs.filter(department__name__icontains=department)

    staff_list = []
    for item in qs.order_by("department__name", "name")[:50]:
        staff_list.append({
            "id": item.id,
            "name": item.name,
            "email": item.email,
            "phone": item.phone or "",
            "role": item.role,
            "department": item.department.name if item.department else "",
            "job_title": item.job_title.name if item.job_title else "",
        })

    return {
        "total": len(staff_list),
        "staff": staff_list,
    }


@register_tool(
    name="system_manage_staff_role",
    description="Phân quyền vai trò hoặc danh sách module truy cập cho nhân sự (Chỉ dành cho Admin).",
    module="account-management",
    min_role="ADMIN",
    audit_action="Cập nhật phân quyền nhân sự",
    parameters={
        "type": "object",
        "properties": {
            "email": {
                "type": "string",
                "description": "Email của nhân viên cần phân quyền",
            },
            "role": {
                "type": "string",
                "enum": ["ADMIN", "MANAGER", "EMPLOYEE", "VIEWER"],
                "description": "Vai trò mới",
            },
            "access_modules": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Danh sách các mã phân hệ được phép truy cập",
            },
        },
        "required": ["email"],
        "additionalProperties": False,
    },
)
def system_manage_staff_role(ctx: Dict[str, Any], email: str, role: str = None, access_modules: list = None, **_kwargs) -> Dict[str, Any]:
    target = UserProfile.objects.filter(email__iexact=email.strip()).first()
    if not target:
        return {"success": False, "error": f"Không tìm thấy nhân sự có email {email}"}

    updates = []
    if role and role in {"ADMIN", "MANAGER", "EMPLOYEE", "VIEWER"}:
        target.role = role
        updates.append("role")
    if access_modules is not None:
        target.access_modules = access_modules
        updates.append("access_modules")

    if updates:
        target.save(update_fields=[*updates, "updated_at"])

    return {
        "success": True,
        "message": f"Đã cập nhật phân quyền cho {target.name} ({target.email}).",
        "current_role": target.role,
        "access_modules": target.access_modules,
    }


@register_tool(
    name="system_get_executive_dashboard",
    description="Bảng tin điều hành tổng hợp thời gian thực cho Ban Giám đốc và Quản lý: Lịch gặp hôm nay, các buổi tập huấn, tiến độ công việc, tỷ lệ chấm công và cảnh báo hết hạn sản phẩm.",
    module="system",
    min_role="MANAGER",
    parameters={
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
)
def system_get_executive_dashboard(ctx: Dict[str, Any], **_kwargs) -> Dict[str, Any]:
    from datetime import timedelta
    from django.utils import timezone
    from digital_training.models import TrainingCustomerMeeting, TrainingLead, TrainingProductSubscription, TrainingSession
    from work_schedule.models import WorkItem
    from attendance.models import AttendanceRecord
    from examination.models import ExamSession

    today = timezone.localdate()

    # 1. Lịch gặp khách hàng & Tập huấn hôm nay
    meetings_today = TrainingCustomerMeeting.objects.filter(meeting_date=today)
    sessions_today = TrainingSession.objects.filter(session_date=today)

    # 2. Tiến độ công việc ngày hôm nay
    tasks_today = WorkItem.objects.filter(work_date=today)
    tasks_total = tasks_today.count()
    tasks_completed = tasks_today.filter(status__in=[WorkItem.STATUS_COMPLETED, WorkItem.STATUS_REVIEWED]).count()
    tasks_doing = tasks_today.filter(status=WorkItem.STATUS_DOING).count()
    tasks_todo = tasks_today.filter(status=WorkItem.STATUS_TODO).count()

    # 3. Chấm công hôm nay
    active_staff_count = UserProfile.objects.filter(employment_status="ACTIVE").count()
    clocked_in_count = AttendanceRecord.objects.filter(work_date=today).count()
    attendance_rate = round((clocked_in_count / active_staff_count * 100), 1) if active_staff_count > 0 else 0

    # 4. Cảnh báo khách hàng & sản phẩm sắp hết hạn trong 30 ngày
    due_date_30d = today + timedelta(days=30)
    expiring_count = TrainingProductSubscription.objects.filter(
        status="active",
        expires_at__isnull=False,
        expires_at__lte=due_date_30d,
    ).exclude(product__code="tap-huan").count()

    # 5. Khảo thí
    running_exams = ExamSession.objects.filter(phase__icontains="diễn ra").count()

    return {
        "date": today.isoformat(),
        "executive_summary": {
            "schedule": {
                "meetings_count": meetings_today.count(),
                "training_sessions_count": sessions_today.count(),
            },
            "tasks": {
                "total": tasks_total,
                "completed": tasks_completed,
                "doing": tasks_doing,
                "todo": tasks_todo,
                "completion_rate_percent": round((tasks_completed / tasks_total * 100), 1) if tasks_total > 0 else 0,
            },
            "attendance": {
                "active_staff": active_staff_count,
                "clocked_in": clocked_in_count,
                "attendance_rate_percent": attendance_rate,
            },
            "alerts": {
                "products_expiring_30_days": expiring_count,
                "running_exam_sessions": running_exams,
            },
        },
        "instruction_for_ai": (
            "Hãy trình bày kết quả này như một 'Bản tin điều hành buổi sáng' chuyên nghiệp cho Lãnh đạo, "
            "sử dụng icon trực quan (📅, ⚡, 👥, ⚠️) và phân nhóm rõ ràng."
        ),
    }
