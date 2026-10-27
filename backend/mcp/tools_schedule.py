from __future__ import annotations

from typing import Any, Dict, List, Optional
from django.utils import timezone

from authentication.models import UserProfile
from work_schedule.models import WorkItem
from .registry import register_tool


@register_tool(
    name="schedule_get_my_tasks",
    description="Xem danh sách công việc được giao của tôi (hoặc nhân sự được chỉ định) theo ngày hoặc khoảng ngày, lọc theo trạng thái (Cần làm, Đang làm, Đã xong).",
    module="work-schedule",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "work_date": {
                "type": "string",
                "description": "Ngày cần xem (YYYY-MM-DD). Mặc định là hôm nay.",
            },
            "status": {
                "type": "string",
                "enum": ["all", "todo", "doing", "completed", "reviewed"],
                "description": "Trạng thái công việc",
            },
            "staff_email": {
                "type": "string",
                "description": "Email nhân viên cần xem (nếu là Quản lý/Admin xem người khác)",
            },
        },
        "additionalProperties": False,
    },
)
def schedule_get_my_tasks(
    ctx: Dict[str, Any],
    work_date: Optional[str] = None,
    status: str = "all",
    staff_email: Optional[str] = None,
    **_kwargs,
) -> Dict[str, Any]:
    target_date = work_date or timezone.localdate().isoformat()
    target_email = ctx["email"]

    # Nếu truyền staff_email và tài khoản hiện tại là Manager hoặc Admin
    if staff_email and ctx["role"] in {"ADMIN", "MANAGER"}:
        target_email = staff_email.strip().lower()

    qs = WorkItem.objects.select_related("creator", "executor").filter(
        executor__email=target_email,
        work_date=target_date,
    )
    if status != "all":
        qs = qs.filter(status=status)

    tasks = []
    for item in qs.order_by("daily_order", "start_time", "created_at"):
        tasks.append({
            "id": item.id,
            "title": item.title,
            "status": item.status,
            "priority": item.priority,
            "start_time": str(item.start_time) if item.start_time else "",
            "end_time": str(item.end_time) if item.end_time else "",
            "progress_note": item.progress_note,
            "review_percent": item.review_percent,
            "review_note": item.review_note,
            "creator": item.creator.name if item.creator else "",
        })

    return {
        "work_date": target_date,
        "employee_email": target_email,
        "count": len(tasks),
        "tasks": tasks,
    }


@register_tool(
    name="schedule_create_task",
    description="Tạo một công việc mới trong Lịch công tác hàng ngày và giao cho nhân sự phụ trách.",
    module="work-schedule",
    min_role="EMPLOYEE",
    audit_action="Tạo công việc trong Lịch công tác",
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Tên/nội dung công việc"},
            "work_date": {"type": "string", "description": "Ngày thực hiện (YYYY-MM-DD)"},
            "executor_email": {
                "type": "string",
                "description": "Email người thực hiện. Để trống sẽ tự giao cho chính mình.",
            },
            "start_time": {"type": "string", "description": "Giờ bắt đầu (HH:MM)"},
            "end_time": {"type": "string", "description": "Giờ kết thúc (HH:MM)"},
            "priority": {
                "type": "string",
                "enum": ["low", "medium", "high"],
                "description": "Mức độ ưu tiên ('low', 'medium', 'high')",
            },
            "description": {"type": "string", "description": "Mô tả chi tiết yêu cầu công việc"},
        },
        "required": ["title", "work_date"],
        "additionalProperties": False,
    },
)
def schedule_create_task(
    ctx: Dict[str, Any],
    title: str,
    work_date: str,
    executor_email: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    priority: str = "medium",
    description: str = "",
    **_kwargs,
) -> Dict[str, Any]:
    current_profile: UserProfile = ctx["profile"]

    target_executor = current_profile
    if executor_email and executor_email.strip():
        found = UserProfile.objects.filter(email__iexact=executor_email.strip()).first()
        if found:
            target_executor = found

    # Tính daily order
    last_order = (
        WorkItem.objects.filter(executor=target_executor, work_date=work_date)
        .order_by("-daily_order")
        .values_list("daily_order", flat=True)
        .first()
        or 0
    )

    item = WorkItem.objects.create(
        creator=current_profile,
        executor=target_executor,
        title=title.strip(),
        work_date=work_date,
        start_time=start_time or None,
        end_time=end_time or None,
        priority=priority,
        description=description,
        status=WorkItem.STATUS_TODO,
        daily_order=last_order + 1,
    )

    return {
        "success": True,
        "message": f"Đã tạo công việc '{item.title}' ngày {work_date} giao cho {target_executor.name}.",
        "task_id": item.id,
    }


@register_tool(
    name="schedule_update_task_progress",
    description="Cập nhật trạng thái công việc (Cần làm, Đang làm, Đã hoàn thành) và ghi chú tiến độ thực hiện.",
    module="work-schedule",
    min_role="EMPLOYEE",
    audit_action="Cập nhật tiến độ công việc",
    parameters={
        "type": "object",
        "properties": {
            "task_id": {"type": "integer", "description": "ID công việc"},
            "status": {
                "type": "string",
                "enum": ["todo", "doing", "completed"],
                "description": "Trạng thái mới của công việc",
            },
            "progress_note": {"type": "string", "description": "Ghi chú tiến độ, kết quả hoàn thành"},
        },
        "required": ["task_id"],
        "additionalProperties": False,
    },
)
def schedule_update_task_progress(
    ctx: Dict[str, Any],
    task_id: int,
    status: Optional[str] = None,
    progress_note: Optional[str] = None,
    **_kwargs,
) -> Dict[str, Any]:
    item = WorkItem.objects.filter(pk=task_id).first()
    if not item:
        return {"success": False, "error": f"Không tìm thấy công việc ID {task_id}"}

    # Chỉ người được giao hoặc Manager/Admin mới được cập nhật
    user_pk = getattr(ctx["profile"], "pk", None) or getattr(ctx["profile"], "email", None)
    if item.executor_id != user_pk and ctx["role"] not in {"ADMIN", "MANAGER"}:
        return {"success": False, "error": "Bạn chỉ được cập nhật công việc do chính mình thực hiện."}

    updates = []
    if status and status in {WorkItem.STATUS_TODO, WorkItem.STATUS_DOING, WorkItem.STATUS_COMPLETED}:
        item.status = status
        updates.append("status")
    if progress_note is not None:
        item.progress_note = progress_note.strip()
        updates.append("progress_note")

    if updates:
        item.save(update_fields=[*updates, "updated_at"])

    return {
        "success": True,
        "message": f"Đã cập nhật công việc '{item.title}'. Trạng thái: {item.status}.",
        "task": {
            "id": item.id,
            "status": item.status,
            "progress_note": item.progress_note,
        },
    }


@register_tool(
    name="schedule_review_task",
    description="Chấm điểm đánh giá % và ghi nhận xét review kết quả công việc của nhân viên (Chỉ dành cho Manager hoặc Admin).",
    module="work-schedule",
    min_role="MANAGER",
    audit_action="Review đánh giá công việc nhân viên",
    parameters={
        "type": "object",
        "properties": {
            "task_id": {"type": "integer", "description": "ID công việc"},
            "review_percent": {
                "type": "integer",
                "minimum": 0,
                "maximum": 100,
                "description": "Điểm đánh giá hoàn thành từ 0% đến 100%",
            },
            "review_note": {"type": "string", "description": "Nhận xét, góp ý của người quản lý"},
        },
        "required": ["task_id", "review_percent"],
        "additionalProperties": False,
    },
)
def schedule_review_task(
    ctx: Dict[str, Any],
    task_id: int,
    review_percent: int,
    review_note: str = "",
    **_kwargs,
) -> Dict[str, Any]:
    item = WorkItem.objects.filter(pk=task_id).first()
    if not item:
        return {"success": False, "error": f"Không tìm thấy công việc ID {task_id}"}

    item.review_percent = max(0, min(100, review_percent))
    item.review_note = review_note.strip()
    item.reviewed_by = ctx["profile"]
    item.reviewed_at = timezone.now()
    item.status = WorkItem.STATUS_REVIEWED
    item.save(update_fields=["review_percent", "review_note", "reviewed_by", "reviewed_at", "status", "updated_at"])

    return {
        "success": True,
        "message": f"Đã đánh giá {item.review_percent}% cho công việc '{item.title}'.",
        "task_id": item.id,
        "status": item.status,
    }


@register_tool(
    name="schedule_export_tasks",
    description="Xuất (export) danh sách công việc trong Lịch công tác theo khoảng thời gian, nhân sự hoặc phòng ban ra định dạng CSV (UTF-8 BOM tải vào Excel) hoặc JSON.",
    module="work-schedule",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "date_from": {
                "type": "string",
                "description": "Từ ngày (YYYY-MM-DD)",
            },
            "date_to": {
                "type": "string",
                "description": "Đến ngày (YYYY-MM-DD)",
            },
            "staff_email": {
                "type": "string",
                "description": "Lọc theo email nhân sự thực hiện (nếu Quản lý/Admin xem người khác)",
            },
            "status": {
                "type": "string",
                "enum": ["all", "todo", "doing", "completed", "reviewed"],
                "description": "Lọc theo trạng thái ('all', 'todo', 'doing', 'completed', 'reviewed')",
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
def schedule_export_tasks(
    ctx: Dict[str, Any],
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    staff_email: Optional[str] = None,
    status: str = "all",
    format: str = "json",
    **_kwargs,
) -> Dict[str, Any]:
    today_str = timezone.localdate().isoformat()
    start_d = date_from or today_str
    end_d = date_to or today_str

    qs = WorkItem.objects.select_related("creator", "executor", "reviewed_by").filter(
        work_date__gte=start_d,
        work_date__lte=end_d,
    )
    if staff_email:
        if ctx["role"] in {"ADMIN", "MANAGER"}:
            qs = qs.filter(executor__email__iexact=staff_email.strip())
        else:
            qs = qs.filter(executor__email=ctx["email"])
    elif ctx["role"] not in {"ADMIN", "MANAGER"}:
        qs = qs.filter(executor__email=ctx["email"])

    if status != "all":
        qs = qs.filter(status=status)

    items = []
    for it in qs.order_by("work_date", "daily_order", "created_at")[:500]:
        items.append({
            "id": it.id,
            "work_date": it.work_date.isoformat() if hasattr(it.work_date, "isoformat") else str(it.work_date),
            "title": it.title,
            "executor_name": it.executor.name if it.executor else "",
            "executor_email": it.executor.email if it.executor else "",
            "start_time": str(it.start_time) if it.start_time else "",
            "end_time": str(it.end_time) if it.end_time else "",
            "priority": it.priority,
            "status": it.status,
            "progress_note": it.progress_note or "",
            "review_percent": it.review_percent,
            "review_note": it.review_note or "",
            "reviewed_by": it.reviewed_by.name if it.reviewed_by else "",
        })

    if format == "csv":
        import csv
        import io
        out = io.StringIO()
        out.write("\ufeff")  # UTF-8 BOM
        writer = csv.writer(out)
        writer.writerow([
            "STT", "Mã công việc", "Ngày thực hiện", "Nội dung công việc", "Nhân sự thực hiện",
            "Giờ bắt đầu", "Giờ kết thúc", "Ưu tiên", "Trạng thái", "Tiến độ / Kết quả",
            "Đánh giá (%)", "Nhận xét quản lý", "Người đánh giá",
        ])
        for idx, it in enumerate(items, 1):
            writer.writerow([
                idx, it["id"], it["work_date"], it["title"], it["executor_name"],
                it["start_time"], it["end_time"], it["priority"], it["status"],
                it["progress_note"], it["review_percent"] if it["review_percent"] is not None else "",
                it["review_note"], it["reviewed_by"],
            ])
        return {
            "success": True,
            "format": "csv",
            "count": len(items),
            "csv_content": out.getvalue(),
        }

    return {
        "success": True,
        "format": "json",
        "count": len(items),
        "tasks": items,
    }

