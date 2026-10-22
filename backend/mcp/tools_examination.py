from __future__ import annotations

from typing import Any, Dict, List, Optional
from django.db.models import Q

from examination.models import (
    Candidate,
    CandidateParticipation,
    ExamRoom,
    ExamSession,
    RoundResult,
    SchoolRegistration,
)
from examination.partner_contact_sync import contact_rows
from .registry import register_tool


@register_tool(
    name="exam_list_sessions",
    description="Xem danh sách các kỳ thi khảo thí (FIMO, FIEO, SIAIO...), số lượng thí sinh, các vòng thi và giai đoạn tổ chức.",
    module="examination",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "phase": {
                "type": "string",
                "description": "Lọc theo giai đoạn (ví dụ: 'Chuẩn bị', 'Đang diễn ra', 'Hoàn thành')",
            },
            "query": {
                "type": "string",
                "description": "Tìm kiếm theo tên kỳ thi hoặc mã kỳ thi",
            },
        },
        "additionalProperties": False,
    },
)
def exam_list_sessions(ctx: Dict[str, Any], phase: Optional[str] = None, query: str = "", **_kwargs) -> Dict[str, Any]:
    qs = ExamSession.objects.all()
    if phase:
        qs = qs.filter(phase__icontains=phase)
    if query:
        qs = qs.filter(Q(name__icontains=query) | Q(code__icontains=query))

    sessions = []
    for s in qs.order_by("-updated_at")[:30]:
        sessions.append({
            "id": s.id,
            "code": s.code,
            "name": s.name,
            "organizer": s.organizer,
            "time": s.time,
            "candidates_count": s.candidates_count,
            "phase": s.phase,
            "rounds": s.rounds,
            "registration_sheet_url": s.registration_sheet_url,
        })

    return {
        "count": len(sessions),
        "sessions": sessions,
    }


@register_tool(
    name="exam_search_candidates",
    description="Tra cứu thí sinh dự thi theo Mã thí sinh (SBD/Mã FT), họ tên, CCCD/Định danh, số điện thoại, trường học hoặc khối lớp.",
    module="examination",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Mã thí sinh (SBD), họ tên, CCCD, SĐT hoặc trường",
            },
            "session_id": {
                "type": "string",
                "description": "Lọc thí sinh tham gia trong kỳ thi cụ thể",
            },
            "grade": {
                "type": "string",
                "description": "Lọc theo khối lớp (ví dụ: '6')",
            },
        },
        "required": ["query"],
        "additionalProperties": False,
    },
)
def exam_search_candidates(ctx: Dict[str, Any], query: str, session_id: Optional[str] = None, grade: Optional[str] = None, **_kwargs) -> Dict[str, Any]:
    clean = query.strip()
    qs = Candidate.objects.all()

    if session_id:
        qs = qs.filter(session_ids__contains=[session_id])
    if grade:
        qs = qs.filter(grade=str(grade).strip())

    qs = qs.filter(
        Q(code__iexact=clean)
        | Q(name__icontains=clean)
        | Q(identity__iexact=clean)
        | Q(phone__icontains=clean)
        | Q(school__icontains=clean)
    )

    candidates = []
    for c in qs.order_by("name")[:30]:
        candidates.append({
            "id": c.id,
            "code": c.code,
            "name": c.name,
            "grade": c.grade,
            "class_name": c.class_name,
            "school": c.school,
            "city": c.city,
            "identity": c.identity,
            "phone": c.phone,
            "email": c.email,
            "contests": c.contests,
            "achievement": c.achievement,
            "highest_round": c.highest_round,
        })

    return {
        "count": len(candidates),
        "candidates": candidates,
    }


@register_tool(
    name="exam_get_candidate_detail",
    description="Xem toàn bộ hồ sơ chi tiết và lịch sử thi các vòng, điểm số, giải thưởng của thí sinh.",
    module="examination",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "candidate_code": {
                "type": "string",
                "description": "Mã thí sinh (Mã FT hoặc SBD)",
            },
        },
        "required": ["candidate_code"],
        "additionalProperties": False,
    },
)
def exam_get_candidate_detail(ctx: Dict[str, Any], candidate_code: str, **_kwargs) -> Dict[str, Any]:
    code = candidate_code.strip()
    candidate = Candidate.objects.filter(Q(code__iexact=code) | Q(id=code)).first()
    if not candidate:
        return {"success": False, "error": f"Không tìm thấy thí sinh với mã '{code}'"}

    # Lấy thông tin các vòng thi & phòng thi
    round_results = RoundResult.objects.filter(participation__candidate=candidate).select_related(
        "exam_room", "participation__session"
    )
    round_info = [
        {
            "session": r.participation.session.code if r.participation and r.participation.session else "",
            "round_name": r.round_name,
            "sbd": r.sbd,
            "exam_room": r.exam_room.name if r.exam_room else (r.room_name or ""),
            "exam_date": r.exam_date,
            "score": r.score,
            "result": r.result,
            "attendance": r.attendance or "Chưa điểm danh",
            "eligibility": r.eligibility,
        }
        for r in round_results
    ]

    return {
        "success": True,
        "candidate": {
            "id": candidate.id,
            "code": candidate.code,
            "name": candidate.name,
            "birth_date": candidate.birth_date,
            "gender": getattr(candidate, "gender", ""),
            "school": candidate.school,
            "grade": candidate.grade,
            "class_name": candidate.class_name,
            "city": candidate.city,
            "ward": candidate.ward,
            "identity": candidate.identity,
            "parent": candidate.parent,
            "phone": candidate.phone,
            "email": candidate.email,
            "address": candidate.address,
            "exam_history": candidate.exam_history or [],
            "achievement": candidate.achievement,
            "highest_round": candidate.highest_round,
            "rooms": room_info,
        },
    }


@register_tool(
    name="exam_update_candidate_info",
    description="Cập nhật thông tin thí sinh (SĐT, Email, Trường, Khối...). Tuân thủ quy tắc không ghi đè ô rỗng và tự động xuất ra Sheet qua hàng đợi.",
    module="examination",
    min_role="EMPLOYEE",
    audit_action="Cập nhật thông tin thí sinh",
    parameters={
        "type": "object",
        "properties": {
            "candidate_code": {"type": "string", "description": "Mã thí sinh"},
            "phone": {"type": "string", "description": "Số điện thoại mới (10 số)"},
            "email": {"type": "string", "description": "Email mới"},
            "school": {"type": "string", "description": "Tên trường học mới"},
            "grade": {"type": "string", "description": "Khối lớp dạng số (ví dụ: '6')"},
            "class_name": {"type": "string", "description": "Tên lớp học (ví dụ: '6A1')"},
        },
        "required": ["candidate_code"],
        "additionalProperties": False,
    },
)
def exam_update_candidate_info(
    ctx: Dict[str, Any],
    candidate_code: str,
    phone: Optional[str] = None,
    email: Optional[str] = None,
    school: Optional[str] = None,
    grade: Optional[str] = None,
    class_name: Optional[str] = None,
    **_kwargs,
) -> Dict[str, Any]:
    code = candidate_code.strip()
    candidate = Candidate.objects.filter(Q(code__iexact=code) | Q(id=code)).first()
    if not candidate:
        return {"success": False, "error": f"Không tìm thấy thí sinh '{code}'"}

    updates = []
    if phone and phone.strip():
        candidate.phone = phone.strip()
        updates.append("phone")
    if email and email.strip():
        candidate.email = email.strip()
        updates.append("email")
    if school and school.strip():
        candidate.school = school.strip()
        updates.append("school")
    if grade and grade.strip():
        clean_grade = "".join(filter(str.isdigit, str(grade))) or grade.strip()
        candidate.grade = clean_grade
        updates.append("grade")
    if class_name and class_name.strip():
        candidate.class_name = class_name.strip()
        updates.append("class_name")

    if updates:
        candidate.save(update_fields=[*updates, "updated_at"])

    return {
        "success": True,
        "message": f"Đã cập nhật thông tin cho thí sinh {candidate.name} ({candidate.code}).",
        "candidate": {
            "code": candidate.code,
            "name": candidate.name,
            "phone": candidate.phone,
            "email": candidate.email,
            "school": candidate.school,
            "grade": candidate.grade,
            "class_name": candidate.class_name,
        },
    }


@register_tool(
    name="exam_get_partner_teachers",
    description="Tra cứu danh bạ các trường học, giáo viên phụ trách hoặc đầu mối đối tác từng tham gia các kỳ thi khảo thí.",
    module="examination",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "province": {"type": "string", "description": "Lọc theo tỉnh/thành phố"},
            "school_query": {"type": "string", "description": "Tìm kiếm theo tên trường"},
        },
        "additionalProperties": False,
    },
)
def exam_get_partner_teachers(ctx: Dict[str, Any], province: str = "", school_query: str = "", **_kwargs) -> Dict[str, Any]:
    qs = SchoolRegistration.objects.all()
    if province:
        qs = qs.filter(province__icontains=province)
    if school_query:
        qs = qs.filter(school_name__icontains=school_query)

    schools = []
    for s in qs.order_by("province", "school_name")[:40]:
        schools.append({
            "school_name": s.school_name,
            "province": s.province,
            "contact_person": s.contact_person,
            "phone": s.phone,
            "email": s.email,
            "session_code": s.session.code if s.session else "",
            "candidate_count": s.total_candidates,
            "payment_status": s.payment_status,
        })

    return {
        "count": len(schools),
        "schools": schools,
    }
