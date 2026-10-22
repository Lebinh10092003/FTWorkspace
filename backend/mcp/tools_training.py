from __future__ import annotations

from typing import Any, Dict, List, Optional
from django.db import models
from django.utils import timezone

from digital_training.models import (
    TrainingAssessment,
    TrainingClass,
    TrainingPartner,
    TrainingSession,
)
from .registry import register_tool


@register_tool(
    name="training_list_sessions",
    description="Xem danh sách các buổi tập huấn/đào tạo (lọc theo ngày, đối tác khách hàng, người hướng dẫn hoặc trạng thái).",
    module="digital-training",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "partner_id": {"type": "integer", "description": "Lọc theo ID khách hàng"},
            "partner_name": {"type": "string", "description": "Lọc theo tên trường / đối tác"},
            "date_from": {"type": "string", "description": "Từ ngày (YYYY-MM-DD)"},
            "date_to": {"type": "string", "description": "Đến ngày (YYYY-MM-DD)"},
            "status": {
                "type": "string",
                "enum": ["planned", "completed", "cancelled", "unscheduled", "all"],
                "description": "Trạng thái buổi tập huấn",
            },
        },
        "additionalProperties": False,
    },
)
def training_list_sessions(
    ctx: Dict[str, Any],
    partner_id: Optional[int] = None,
    partner_name: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    status: str = "all",
    **_kwargs,
) -> Dict[str, Any]:
    qs = TrainingSession.objects.select_related("partner_ref", "training_class").all()
    if partner_id:
        qs = qs.filter(partner_ref_id=partner_id)
    elif partner_name:
        qs = qs.filter(
            models.Q(partner_ref__name__icontains=partner_name.strip())
            | models.Q(partner__icontains=partner_name.strip())
        )
    if date_from:
        qs = qs.filter(session_date__gte=date_from)
    if date_to:
        qs = qs.filter(session_date__lte=date_to)
    if status and status != "all":
        qs = qs.filter(status=status)

    sessions = []
    for s in qs.order_by("-session_date", "start_time")[:100]:
        total_sessions = ""
        if s.training_class and s.training_class.planned_sessions:
            total_sessions = s.training_class.planned_sessions
        elif s.partner_ref and s.partner_ref.planned_sessions:
            total_sessions = s.partner_ref.planned_sessions

        sessions.append({
            "id": s.id,
            "title": s.title,
            "session_number": s.session_number,
            "total_planned_sessions": total_sessions,
            "partner_name": s.partner_ref.name if s.partner_ref else s.partner,
            "class_name": s.training_class.name if s.training_class else "",
            "date": s.session_date.isoformat() if s.session_date else None,
            "start_time": str(s.start_time) if s.start_time else "",
            "end_time": str(s.end_time) if s.end_time else "",
            "instructor": s.instructor_name,
            "support_staff": s.support_staff_name,
            "attendees": s.attendees,
            "status": s.status,
            "contents": s.contents,
            "location": s.location,
            "notes": s.notes,
        })

    return {
        "count": len(sessions),
        "sessions": sessions,
    }


@register_tool(
    name="training_create_session",
    description="Tạo lịch cho một buổi tập huấn / đào tạo mới với khách hàng và tự động cập nhật Tab Nhật ký tập huấn trên Google Sheet.",
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Tạo buổi tập huấn mới",
    parameters={
        "type": "object",
        "properties": {
            "partner_id": {"type": "integer", "description": "ID khách hàng/đối tác (nếu biết)"},
            "partner_name": {"type": "string", "description": "Tên trường / đơn vị cần tạo lịch tập huấn"},
            "class_name": {"type": "string", "description": "Tên lớp hoặc phân nhóm (ví dụ: 'Khối 6-7', 'GV Tin học')"},
            "class_id": {"type": "integer", "description": "ID lớp học (nếu đã có)"},
            "title": {"type": "string", "description": "Tiêu đề buổi đào tạo/tập huấn"},
            "session_date": {"type": "string", "description": "Ngày tập huấn (YYYY-MM-DD)"},
            "start_time": {"type": "string", "description": "Giờ bắt đầu (HH:MM)"},
            "end_time": {"type": "string", "description": "Giờ kết thúc (HH:MM)"},
            "session_number": {"type": "integer", "description": "Số thứ tự buổi (ví dụ: 1 cho Buổi 1, 2 cho Buổi 2)"},
            "total_planned_sessions": {"type": "integer", "description": "Tổng số buổi của khóa/lớp học này (nếu chưa đặt)"},
            "instructor_name": {"type": "string", "description": "Giảng viên / Báo cáo viên chính"},
            "support_staff_name": {"type": "string", "description": "Trợ giảng / Hỗ trợ kỹ thuật"},
            "location": {"type": "string", "description": "Địa điểm hoặc Link Google Meet/Zoom"},
            "attendees": {"type": "integer", "description": "Số lượng giáo viên/học viên tham dự"},
            "contents": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Danh sách các nội dung giảng dạy",
            },
            "notes": {"type": "string", "description": "Ghi chú thêm về buổi tập huấn"},
        },
        "required": ["title", "session_date"],
        "additionalProperties": False,
    },
)
def training_create_session(
    ctx: Dict[str, Any],
    title: str,
    session_date: str,
    partner_id: Optional[int] = None,
    partner_name: str = "",
    class_name: str = "",
    class_id: Optional[int] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    session_number: Optional[int] = None,
    total_planned_sessions: Optional[int] = None,
    instructor_name: str = "",
    support_staff_name: str = "",
    location: str = "",
    attendees: int = 0,
    contents: Optional[List[str]] = None,
    notes: str = "",
    **_kwargs,
) -> Dict[str, Any]:
    partner = None
    if partner_id:
        partner = TrainingPartner.objects.filter(pk=partner_id).first()
    elif partner_name:
        partner = TrainingPartner.objects.filter(name__icontains=partner_name.strip()).first()

    if not partner and (partner_id or partner_name):
        return {"success": False, "error": f"Không tìm thấy khách hàng khớp với '{partner_name or partner_id}'."}

    # Tìm hoặc tạo lớp học
    training_class = None
    if class_id:
        training_class = TrainingClass.objects.filter(pk=class_id).first()
    elif class_name and partner:
        training_class = TrainingClass.objects.filter(partner=partner, name__iexact=class_name.strip()).first()
        if not training_class:
            training_class = TrainingClass.objects.create(
                partner=partner,
                name=class_name.strip(),
                planned_sessions=total_planned_sessions or 1,
            )

    if total_planned_sessions:
        if training_class and training_class.planned_sessions != total_planned_sessions:
            training_class.planned_sessions = total_planned_sessions
            training_class.save(update_fields=["planned_sessions"])
        elif partner and not partner.planned_sessions:
            partner.planned_sessions = total_planned_sessions
            partner.save(update_fields=["planned_sessions"])

    session = TrainingSession.objects.create(
        partner_ref=partner,
        partner=partner.name if partner else (partner_name or ""),
        training_class=training_class,
        title=title.strip(),
        session_date=session_date,
        start_time=start_time or None,
        end_time=end_time or None,
        session_number=session_number,
        instructor_name=instructor_name or ctx.get("name", ""),
        support_staff_name=support_staff_name,
        location=location or (partner.training_location if partner else "") or "",
        attendees=attendees or 0,
        contents=contents or [],
        notes=notes,
        status="planned",
    )

    # Tự động xuất ra Google Sheet tab 'Nhật ký tập huấn'
    sheet_status = "unconfigured"
    try:
        from digital_training.training_sheet_sync import export_training_sessions_to_sheet
        res = export_training_sessions_to_sheet(force=True)
        sheet_status = res.get("status", "ok")
    except Exception as exc:
        sheet_status = f"error: {exc}"

    return {
        "success": True,
        "message": f"Đã tạo buổi tập huấn '{session.title}' thành công.",
        "session_id": session.id,
        "session_date": session.session_date.isoformat(),
        "partner": partner.name if partner else "",
        "class_name": training_class.name if training_class else "",
        "session_number": session.session_number,
        "sheet_sync_status": sheet_status,
    }


@register_tool(
    name="training_update_session",
    description="Cập nhật thông tin buổi tập huấn (hoàn thành, đổi ngày, giảng viên, số người tham dự, ghi chú) và tự động đồng bộ ra Google Sheet.",
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Cập nhật buổi tập huấn",
    parameters={
        "type": "object",
        "properties": {
            "session_id": {"type": "integer", "description": "ID buổi tập huấn"},
            "status": {
                "type": "string",
                "enum": ["completed", "planned", "cancelled", "unscheduled"],
                "description": "Trạng thái mới: 'completed' (đã hoàn thành), 'planned' (đã lên lịch), 'cancelled' (đã hủy)",
            },
            "session_date": {"type": "string", "description": "Ngày tập huấn mới (YYYY-MM-DD)"},
            "start_time": {"type": "string", "description": "Giờ bắt đầu (HH:MM)"},
            "end_time": {"type": "string", "description": "Giờ kết thúc (HH:MM)"},
            "instructor_name": {"type": "string", "description": "Giảng viên chính"},
            "support_staff_name": {"type": "string", "description": "Trợ giảng / Kỹ thuật"},
            "attendees": {"type": "integer", "description": "Số lượng giáo viên/học viên tham dự"},
            "location": {"type": "string", "description": "Địa điểm hoặc Link Google Meet/Zoom"},
            "notes": {"type": "string", "description": "Ghi chú đánh giá chất lượng buổi học"},
        },
        "required": ["session_id"],
        "additionalProperties": False,
    },
)
def training_update_session(
    ctx: Dict[str, Any],
    session_id: int,
    status: Optional[str] = None,
    session_date: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    instructor_name: Optional[str] = None,
    support_staff_name: Optional[str] = None,
    attendees: Optional[int] = None,
    location: Optional[str] = None,
    notes: Optional[str] = None,
    **_kwargs,
) -> Dict[str, Any]:
    session = TrainingSession.objects.filter(pk=session_id).first()
    if not session:
        return {"success": False, "error": f"Không tìm thấy buổi tập huấn ID {session_id}"}

    updates = []
    if status and status != session.status:
        session.status = status
        updates.append("status")
    if session_date:
        session.session_date = session_date
        updates.append("session_date")
    if start_time:
        session.start_time = start_time
        updates.append("start_time")
    if end_time:
        session.end_time = end_time
        updates.append("end_time")
    if instructor_name is not None:
        session.instructor_name = instructor_name
        updates.append("instructor_name")
    if support_staff_name is not None:
        session.support_staff_name = support_staff_name
        updates.append("support_staff_name")
    if attendees is not None:
        session.attendees = attendees
        updates.append("attendees")
    if location is not None:
        session.location = location
        updates.append("location")
    if notes is not None:
        session.notes = notes
        updates.append("notes")

    if updates:
        session.save(update_fields=[*updates, "updated_at"])

    # Tự động xuất ra Google Sheet
    sheet_status = "unconfigured"
    try:
        from digital_training.training_sheet_sync import export_training_sessions_to_sheet
        res = export_training_sessions_to_sheet(force=True)
        sheet_status = res.get("status", "ok")
    except Exception as exc:
        sheet_status = f"error: {exc}"

    return {
        "success": True,
        "message": f"Đã cập nhật buổi tập huấn ID {session.id} ('{session.title}').",
        "session": {
            "id": session.id,
            "title": session.title,
            "status": session.status,
            "date": session.session_date.isoformat() if session.session_date else None,
            "instructor": session.instructor_name,
            "attendees": session.attendees,
            "sheet_sync_status": sheet_status,
        },
    }


@register_tool(
    name="training_create_class",
    description="Tạo một lớp học hoặc phân nhóm tập huấn mới cho khách hàng (ví dụ: 'Khối 6-7', 'Lớp Mầm non 1').",
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Tạo lớp tập huấn",
    parameters={
        "type": "object",
        "properties": {
            "partner_id": {"type": "integer", "description": "ID khách hàng/trường đối tác"},
            "partner_name": {"type": "string", "description": "Tên trường nếu không nhớ ID"},
            "name": {"type": "string", "description": "Tên lớp/phân nhóm (ví dụ: 'Lớp 1', 'Khối THCS')"},
            "planned_sessions": {"type": "integer", "description": "Tổng số buổi đào tạo dự kiến"},
            "members": {"type": "string", "description": "Danh sách hoặc mô tả đối tượng học viên"},
            "training_contents": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Các chủ đề đào tạo của lớp",
            },
            "notes": {"type": "string", "description": "Ghi chú riêng của lớp"},
        },
        "required": ["name"],
        "additionalProperties": False,
    },
)
def training_create_class(
    ctx: Dict[str, Any],
    name: str,
    partner_id: Optional[int] = None,
    partner_name: str = "",
    planned_sessions: int = 1,
    members: str = "",
    training_contents: Optional[List[str]] = None,
    notes: str = "",
    **_kwargs,
) -> Dict[str, Any]:
    partner = None
    if partner_id:
        partner = TrainingPartner.objects.filter(pk=partner_id).first()
    elif partner_name:
        partner = TrainingPartner.objects.filter(name__icontains=partner_name.strip()).first()

    if not partner:
        return {"success": False, "error": "Vui lòng cung cấp partner_id hoặc partner_name hợp lệ."}

    t_class, created = TrainingClass.objects.get_or_create(
        partner=partner,
        name=name.strip(),
        defaults={
            "planned_sessions": planned_sessions,
            "members": members,
            "training_contents": training_contents or [],
            "notes": notes,
        },
    )
    if not created:
        t_class.planned_sessions = planned_sessions
        if members:
            t_class.members = members
        if training_contents:
            t_class.training_contents = training_contents
        if notes:
            t_class.notes = notes
        t_class.save()

    return {
        "success": True,
        "message": f"{'Đã tạo mới' if created else 'Đã cập nhật'} lớp '{t_class.name}' cho trường '{partner.name}'.",
        "class_id": t_class.id,
        "partner_name": partner.name,
        "planned_sessions": t_class.planned_sessions,
    }


@register_tool(
    name="training_sync_sessions_sheet",
    description="Kích hoạt đồng bộ 2 chiều Tab Nhật ký tập huấn giữa Web FTWorkspace và Google Sheet chỉ định.",
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Đồng bộ Google Sheet Nhật ký tập huấn",
    parameters={
        "type": "object",
        "properties": {
            "force": {
                "type": "boolean",
                "description": "Bắt buộc ghi ra Sheet kể cả khi không có thay đổi",
            },
        },
        "additionalProperties": False,
    },
)
def training_sync_sessions_sheet(ctx: Dict[str, Any], force: bool = True, **_kwargs) -> Dict[str, Any]:
    from digital_training.training_sheet_sync import sync_training_sessions_safely
    try:
        res = sync_training_sessions_safely(force=force)
        return {
            "success": True,
            "message": "Đã thực hiện đồng bộ thành công Tab Nhật ký tập huấn với Google Sheet.",
            "data": res,
        }
    except Exception as exc:
        return {
            "success": False,
            "error": f"Lỗi đồng bộ Sheet tập huấn: {exc}",
        }


@register_tool(
    name="training_get_assessment_results",
    description="Tra cứu kết quả bài kiểm tra đánh giá cuối khóa tập huấn (điểm số, số lượng người tham gia, tỷ lệ đạt).",
    module="digital-training",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "partner_id": {"type": "integer", "description": "Lọc theo ID khách hàng"},
            "assessment_id": {"type": "integer", "description": "ID bài kiểm tra (nếu có)"},
        },
        "additionalProperties": False,
    },
)
def training_get_assessment_results(
    ctx: Dict[str, Any],
    partner_id: Optional[int] = None,
    assessment_id: Optional[int] = None,
    **_kwargs,
) -> Dict[str, Any]:
    qs = TrainingAssessment.objects.all()
    if assessment_id:
        qs = qs.filter(pk=assessment_id)
    elif partner_id:
        qs = qs.filter(partner_id=partner_id)

    assessments = []
    for a in qs.order_by("-created_at")[:10]:
        attempts = a.attempts.all()
        submitted = attempts.filter(status="submitted")
        avg_score = 0
        if submitted.exists():
            scores = [float(att.score) for att in submitted if att.score is not None]
            if scores:
                avg_score = round(sum(scores) / len(scores), 2)

        assessments.append({
            "id": a.id,
            "title": a.title,
            "partner_name": a.partner.name if a.partner else "",
            "status": a.status,
            "total_attempts": attempts.count(),
            "submitted_count": submitted.count(),
            "average_score": avg_score,
            "public_slug": a.public_slug,
        })

    return {
        "count": len(assessments),
        "assessments": assessments,
    }


@register_tool(
    name="training_export_sessions",
    description="Xuất (export) danh sách các buổi tập huấn / đào tạo theo đối tác, giảng viên hoặc khoảng thời gian ra CSV (UTF-8 BOM tải vào Excel) hoặc JSON.",
    module="digital-training",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "partner_name": {"type": "string", "description": "Lọc theo tên trường / đối tác"},
            "date_from": {"type": "string", "description": "Từ ngày (YYYY-MM-DD)"},
            "date_to": {"type": "string", "description": "Đến ngày (YYYY-MM-DD)"},
            "status": {
                "type": "string",
                "enum": ["planned", "completed", "cancelled", "unscheduled", "all"],
                "description": "Lọc theo trạng thái ('all', 'planned', 'completed', 'cancelled')",
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
def training_export_sessions(
    ctx: Dict[str, Any],
    partner_name: str = "",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    status: str = "all",
    format: str = "json",
    **_kwargs,
) -> Dict[str, Any]:
    qs = TrainingSession.objects.select_related("partner_ref", "training_class").all()
    if partner_name:
        qs = qs.filter(
            models.Q(partner_ref__name__icontains=partner_name.strip())
            | models.Q(partner__icontains=partner_name.strip())
        )
    if date_from:
        qs = qs.filter(session_date__gte=date_from)
    if date_to:
        qs = qs.filter(session_date__lte=date_to)
    if status and status != "all":
        qs = qs.filter(status=status)

    items = []
    for s in qs.order_by("-session_date", "start_time")[:500]:
        items.append({
            "id": s.id,
            "title": s.title,
            "partner_name": s.partner_ref.name if s.partner_ref else s.partner,
            "class_name": s.training_class.name if s.training_class else "",
            "session_number": s.session_number,
            "session_date": s.session_date.isoformat() if s.session_date else "",
            "start_time": str(s.start_time) if s.start_time else "",
            "end_time": str(s.end_time) if s.end_time else "",
            "instructor": s.instructor_name or "",
            "support_staff": s.support_staff_name or "",
            "status": s.status,
            "location": s.location or "",
            "attendees": s.attendees,
            "notes": s.notes or "",
        })

    if format == "csv":
        import csv
        import io
        out = io.StringIO()
        out.write("\ufeff")  # UTF-8 BOM
        writer = csv.writer(out)
        writer.writerow([
            "STT", "Mã buổi", "Tiêu đề", "Trường / Khách hàng", "Lớp đào tạo",
            "Buổi số", "Ngày tập huấn", "Giờ bắt đầu", "Giờ kết thúc",
            "Giảng viên chính", "Trợ giảng / Hỗ trợ", "Trạng thái", "Địa điểm / Link", "Số người tham gia", "Ghi chú",
        ])
        for idx, it in enumerate(items, 1):
            writer.writerow([
                idx, it["id"], it["title"], it["partner_name"], it["class_name"],
                it["session_number"], it["session_date"], it["start_time"], it["end_time"],
                it["instructor"], it["support_staff"], it["status"], it["location"], it["attendees"], it["notes"],
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
        "sessions": items,
    }

