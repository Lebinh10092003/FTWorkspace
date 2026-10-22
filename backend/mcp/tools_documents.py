from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

from documents.funding_numbering import assign_funding_number
from documents.models import FundingProposalRecord, WeeklyReport
from documents.numbering import DOCUMENT_TYPES, format_number, register_state
from .registry import register_tool


@register_tool(
    name="docs_get_document_number_preview",
    description="Xem số công văn / văn bản hành chính tiếp theo sẽ được cấp (theo mẫu số chính thức của FermatTech).",
    module="documents",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "document_type": {
                "type": "string",
                "enum": ["Công văn", "Tờ trình", "Quyết định", "Kế hoạch", "Thông báo", "Biên bản", "Báo cáo", "Báo giá"],
                "description": "Loại văn bản hành chính",
            },
        },
        "additionalProperties": False,
    },
)
def docs_get_document_number_preview(ctx: Dict[str, Any], document_type: str = "Công văn", **_kwargs) -> Dict[str, Any]:
    try:
        state = register_state(google_token=None)
        next_num = state.get("next", 1)
        preview_str = format_number(next_num, document_type)
        return {
            "success": True,
            "document_type": document_type,
            "next_sequence": next_num,
            "formatted_number": preview_str,
            "supported_types": DOCUMENT_TYPES,
        }
    except Exception as exc:
        return {
            "success": False,
            "error": f"Không thể đọc sổ công văn: {exc}",
        }


@register_tool(
    name="docs_create_funding_proposal",
    description="Cấp mã số cho Phiếu đề xuất kinh phí cho các hoạt động, sự kiện hoặc công tác đào tạo.",
    module="documents",
    min_role="EMPLOYEE",
    audit_action="Cấp số phiếu đề xuất kinh phí",
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Tên nội dung đề xuất kinh phí"},
        },
        "required": ["title"],
        "additionalProperties": False,
    },
)
def docs_create_funding_proposal(ctx: Dict[str, Any], title: str, **_kwargs) -> Dict[str, Any]:
    email = ctx["email"]
    draft_id = uuid.uuid4()
    seq_number, doc_number = assign_funding_number(str(draft_id), email)

    return {
        "success": True,
        "message": f"Đã cấp số đề xuất kinh phí: {doc_number}",
        "sequence_number": seq_number,
        "document_number": doc_number,
        "owner_email": email,
        "draft_id": str(draft_id),
    }


@register_tool(
    name="docs_get_weekly_report",
    description="Tra cứu nội dung báo cáo tuần của nhân sự (công việc đã làm, khó khăn vướng mắc, kế hoạch tuần tới).",
    module="documents",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "week_number": {"type": "integer", "description": "Tuần báo cáo (ví dụ: tuần 41)"},
            "staff_email": {"type": "string", "description": "Email nhân viên (nếu Quản lý xem người khác)"},
        },
        "additionalProperties": False,
    },
)
def docs_get_weekly_report(ctx: Dict[str, Any], week_number: Optional[int] = None, staff_email: Optional[str] = None, **_kwargs) -> Dict[str, Any]:
    target_email = staff_email.strip().lower() if (staff_email and ctx["role"] in {"ADMIN", "MANAGER"}) else ctx["email"]
    qs = WeeklyReport.objects.filter(employee_email__iexact=target_email)
    if week_number:
        qs = qs.filter(completed_week=week_number)

    report = qs.order_by("-completed_week").first()
    if not report:
        return {"success": False, "error": f"Chưa có báo cáo tuần cho nhân sự {target_email}."}

    return {
        "success": True,
        "employee_name": report.employee_name,
        "completed_week": report.completed_week,
        "planned_week": report.planned_week,
        "status": report.status,
        "completed_items": report.completed_items,
        "difficulties": report.difficulties,
        "planned_items": report.planned_items,
    }


@register_tool(
    name="docs_generate_weekly_report",
    description="Tự động trích xuất các công việc đã hoàn thành và việc kế hoạch từ Lịch công tác để lập bản thảo Báo cáo tuần hoàn chỉnh.",
    module="documents",
    min_role="EMPLOYEE",
    audit_action="Lập báo cáo tuần tự động từ Lịch công tác",
    parameters={
        "type": "object",
        "properties": {
            "staff_email": {"type": "string", "description": "Email nhân viên (mặc định là chính mình)"},
            "difficulties": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Các khó khăn, vướng mắc phát sinh trong tuần (nếu có)",
            },
        },
        "additionalProperties": False,
    },
)
def docs_generate_weekly_report(
    ctx: Dict[str, Any],
    staff_email: Optional[str] = None,
    difficulties: Optional[list] = None,
    **_kwargs,
) -> Dict[str, Any]:
    from datetime import timedelta
    from django.utils import timezone
    from work_schedule.models import WorkItem

    today = timezone.localdate()
    target_email = staff_email.strip().lower() if (staff_email and ctx["role"] in {"ADMIN", "MANAGER"}) else ctx["email"]
    profile = ctx["profile"] if target_email == ctx["email"] else None

    # Tính toán ngày đầu tuần (Thứ Hai) và cuối tuần (Chủ Nhật)
    start_of_week = today - timedelta(days=today.weekday())
    end_of_week = start_of_week + timedelta(days=6)
    week_num = today.isocalendar()[1]

    items = WorkItem.objects.filter(
        executor__email=target_email,
        work_date__gte=start_of_week,
        work_date__lte=end_of_week,
    ).order_by("work_date", "daily_order")

    completed = []
    planned = []
    for it in items:
        entry_text = f"[{it.work_date.strftime('%d/%m')}] {it.title}"
        if it.progress_note:
            entry_text += f" (Tiến độ: {it.progress_note})"
        if it.status in {WorkItem.STATUS_COMPLETED, WorkItem.STATUS_REVIEWED}:
            completed.append(entry_text)
        else:
            planned.append(entry_text)

    return {
        "success": True,
        "employee_name": profile.name if profile else target_email,
        "employee_email": target_email,
        "week_number": week_num,
        "date_range": f"{start_of_week.strftime('%d/%m/%Y')} - {end_of_week.strftime('%d/%m/%Y')}",
        "completed_items": completed,
        "planned_items": planned,
        "difficulties": difficulties or ["Không có vướng mắc đáng kể."],
        "instruction_for_ai": (
            "Hãy hoàn thiện bản Báo cáo tuần chuẩn văn thư theo các mục: "
            "I. KẾT QUẢ CÔNG VIỆC TRONG TUẦN; II. KHÓ KHĂN, ĐỀ XUẤT; III. KẾ HOẠCH TUẦN TỚI."
        ),
    }

