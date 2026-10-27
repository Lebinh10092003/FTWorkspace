"""Công cụ MCP vận hành Khảo thí: kết quả vòng thi, phòng thi, đối soát lệ phí.

Quy tắc (AGENTS.md):
- Ghi kết quả vào bản ghi sẵn có của đúng vòng; không tạo bản kết quả thứ hai.
- Lỗi của một dòng chỉ bỏ qua dòng đó.
- Không sửa "Trạng thái dự thi" (chỉ ghi Sheet phân phòng) và không tự xếp phòng/ngày/ca.
- Lưu RoundResult qua ORM để signal đưa thay đổi vào hàng đợi ghi Sheet như khi sửa trên web.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple

from django.db.models import Count, Q
from django.utils import timezone

from examination.eligibility import normalize_eligibility
from examination.models import ExamInvigilationShift, ExamRoom, ExamSession, RoundResult
from examination.sync import format_sheet_percentage

from .registry import register_tool

EDITABLE_RESULT_FIELDS = {
    "score": "score",
    "score_rate": "score_rate",
    "rank": "rank",
    "result": "result",
    "eligibility": "eligibility",
    "sbd": "sbd",
    "note": "note",
}


def _session_and_round(session_id: str, round_id: str = "", round_name: str = "") -> Tuple[Optional[ExamSession], Dict[str, Any], str]:
    session = ExamSession.objects.filter(pk=str(session_id or "").strip()).first()
    if not session:
        return None, {}, f"Không tìm thấy kỳ tổ chức '{session_id}'. Dùng exam_list_sessions để lấy session_id."
    rounds = [item for item in (session.rounds or []) if isinstance(item, dict) and item.get("id")]
    rid, rname = str(round_id or "").strip(), str(round_name or "").strip().casefold()
    match = None
    if rid:
        match = next((r for r in rounds if str(r.get("id")) == rid), None)
    elif rname:
        exact = [r for r in rounds if str(r.get("name") or "").strip().casefold() == rname]
        partial = [r for r in rounds if rname in str(r.get("name") or "").casefold()]
        match = exact[0] if exact else (partial[0] if len(partial) == 1 else None)
    elif len(rounds) == 1:
        match = rounds[0]
    if not match:
        options = "; ".join(f"{r.get('name')} (round_id {r.get('id')})" for r in rounds) or "kỳ chưa cấu hình vòng thi"
        return session, {}, f"Cần chọn đúng một vòng thi của kỳ {session.name}: {options}."
    return session, match, ""


def _round_results(session: ExamSession, round_config: Dict[str, Any]):
    name = str(round_config.get("name") or "").strip()
    return RoundResult.objects.filter(participation__session=session).filter(
        Q(round_id=str(round_config.get("id"))) | Q(round_id="", round_name=name)
    )


def _result_row(item: RoundResult) -> Dict[str, Any]:
    candidate = item.participation.candidate
    return {
        "result_id": str(item.id),
        "candidate_code": candidate.code,
        "name": candidate.name,
        "school": candidate.school,
        "grade": candidate.grade,
        "sbd": item.sbd,
        "room": item.room_name,
        "date": item.exam_date,
        "time": item.time_slot,
        "mode": item.mode,
        "eligibility": item.eligibility,
        "attendance": item.attendance,
        "score": item.score,
        "score_rate": item.score_rate,
        "rank": item.rank,
        "result": item.result,
        "note": item.note,
    }


@register_tool(
    name="exam_list_round_results",
    title="Kết quả vòng thi",
    description=(
        "Xem danh sách thí sinh của một vòng thi trong một kỳ: SBD, phòng, ngày/ca, điều kiện, điểm danh, điểm, "
        "xếp hạng, kết quả. Lọc theo phòng, từ khóa (tên/mã FT/trường), điều kiện, hoặc chỉ người chưa có điểm."
    ),
    module="examination",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "session_id": {"type": "string", "description": "ID kỳ tổ chức (lấy từ exam_list_sessions)"},
            "round_id": {"type": "string"},
            "round_name": {"type": "string", "description": "Tên vòng nếu không có round_id"},
            "room": {"type": "string", "description": "Tên/số phòng"},
            "query": {"type": "string", "description": "Tên, mã FT, SBD hoặc trường"},
            "eligibility": {"type": "string", "enum": ["all", "eligible", "ineligible", "unset"]},
            "missing_score": {"type": "boolean", "description": "Chỉ lấy người chưa có điểm"},
            "limit": {"type": "integer", "description": "Tối đa (mặc định 200, tối đa 1000)"},
        },
        "required": ["session_id"],
        "additionalProperties": False,
    },
)
def exam_list_round_results(ctx: Dict[str, Any], session_id: str, round_id: str = "", round_name: str = "",
                            room: str = "", query: str = "", eligibility: str = "all", missing_score: bool = False,
                            limit: int = 200, **_kwargs: Any) -> Dict[str, Any]:
    session, round_config, error = _session_and_round(session_id, round_id, round_name)
    if error:
        return {"success": False, "error": error}
    qs = _round_results(session, round_config).select_related("participation__candidate")
    if room.strip():
        qs = qs.filter(room_name__icontains=room.strip())
    if query.strip():
        q = query.strip()
        qs = qs.filter(
            Q(participation__candidate__name__icontains=q) | Q(participation__candidate__code__iexact=q)
            | Q(sbd__iexact=q) | Q(participation__candidate__school__icontains=q)
        )
    if eligibility == "eligible":
        qs = qs.filter(eligibility__istartswith="Đủ")
    elif eligibility == "ineligible":
        qs = qs.filter(Q(eligibility__istartswith="Không") | Q(eligibility__istartswith="Chưa"))
    elif eligibility == "unset":
        qs = qs.filter(eligibility="")
    if missing_score:
        qs = qs.filter(score="")
    total = qs.count()
    cap = max(1, min(int(limit or 200), 1000))
    rows = [_result_row(item) for item in qs.order_by("room_name", "sbd", "participation__candidate__name")[:cap]]
    return {
        "session": {"id": session.pk, "name": session.name, "code": session.code},
        "round": {"id": round_config.get("id"), "name": round_config.get("name")},
        "total": total,
        "returned": len(rows),
        "with_score": qs.exclude(score="").count(),
        "results": rows,
    }


@register_tool(
    name="exam_update_round_results",
    title="Nhập kết quả vòng thi",
    description=(
        "Nhập/sửa điểm, tỷ lệ điểm, xếp hạng, kết quả, điều kiện, SBD hoặc ghi chú cho nhiều thí sinh của một vòng thi, "
        "theo mã FT. Chỉ cập nhật bản kết quả sẵn có của vòng đó (không tạo mới); ô để trống được giữ nguyên. "
        "Dòng lỗi chỉ bỏ qua dòng đó. Thay đổi tự ghi ra Google Sheet của kỳ như khi sửa trên web. "
        "Không dùng để điểm danh hay xếp phòng. Chỉ đánh dấu 'Đủ điều kiện' khi người dùng yêu cầu rõ."
    ),
    module="examination",
    min_role="MANAGER",
    audit_action="Nhập kết quả vòng thi",
    parameters={
        "type": "object",
        "properties": {
            "session_id": {"type": "string"},
            "round_id": {"type": "string"},
            "round_name": {"type": "string"},
            "updates": {
                "type": "array",
                "minItems": 1,
                "maxItems": 500,
                "items": {
                    "type": "object",
                    "properties": {
                        "candidate_code": {"type": "string", "description": "Mã FT của thí sinh"},
                        "occurrence_id": {"type": "string", "description": "Chỉ cần khi thí sinh có nhiều ca trong vòng"},
                        "score": {"type": "string"},
                        "score_rate": {"type": "string", "description": "vd '85,5%'"},
                        "rank": {"type": "string"},
                        "result": {"type": "string", "description": "vd 'Huy chương Vàng'"},
                        "eligibility": {"type": "string", "description": "'Đủ điều kiện' hoặc 'Không đủ điều kiện'"},
                        "sbd": {"type": "string"},
                        "note": {"type": "string"},
                    },
                    "required": ["candidate_code"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["session_id", "updates"],
        "additionalProperties": False,
    },
)
def exam_update_round_results(ctx: Dict[str, Any], session_id: str, updates: List[Dict[str, Any]],
                              round_id: str = "", round_name: str = "", **_kwargs: Any) -> Dict[str, Any]:
    session, round_config, error = _session_and_round(session_id, round_id, round_name)
    if error:
        return {"success": False, "error": error}
    from examination.views import append_audit

    actor = SimpleNamespace(user=SimpleNamespace(email=ctx.get("email", "")))
    base = _round_results(session, round_config).select_related("participation__candidate")
    stamp = timezone.localtime().strftime("%d/%m/%Y %H:%M")
    updated, unchanged, skipped = [], [], []
    for index, row in enumerate(updates or [], 1):
        code = str((row or {}).get("candidate_code") or "").strip()
        if not code:
            skipped.append({"row": index, "reason": "Thiếu mã FT."})
            continue
        matches = list(base.filter(participation__candidate__code__iexact=code))
        occurrence = str(row.get("occurrence_id") or "").strip()
        if occurrence:
            matches = [m for m in matches if m.occurrence_id == occurrence]
        if not matches:
            skipped.append({"row": index, "candidate_code": code,
                            "reason": f"Thí sinh không có kết quả của vòng '{round_config.get('name')}' trong kỳ này."})
            continue
        if len(matches) > 1:
            skipped.append({"row": index, "candidate_code": code,
                            "reason": "Thí sinh có nhiều ca trong vòng; cần occurrence_id: "
                                      + ", ".join(m.occurrence_id or "(trống)" for m in matches)})
            continue
        item = matches[0]
        changes = {}
        for key, field in EDITABLE_RESULT_FIELDS.items():
            value = row.get(key)
            if value is None or not str(value).strip():
                continue
            value = str(value).strip()
            if key == "score_rate":
                value = format_sheet_percentage(value)
            elif key == "eligibility":
                value = normalize_eligibility(value)
            if getattr(item, field) != value:
                changes[field] = (getattr(item, field), value)
                setattr(item, field, value)
        if not changes:
            unchanged.append(code)
            continue
        item.save()  # signal: đưa thí sinh vào hàng đợi ghi Sheet của kỳ
        candidate = item.participation.candidate
        candidate.updated = stamp
        candidate.save(update_fields=["updated"])
        summary = "; ".join(f"{field}: '{old}' → '{new}'" for field, (old, new) in changes.items())
        append_audit(f"candidate-{candidate.code}", f"[Trợ lý AI] {round_config.get('name')}: {summary}", actor)
        updated.append({"candidate_code": candidate.code, "name": candidate.name, "changed": sorted(changes)})

    if updated:
        append_audit(
            f"session-{session.pk}",
            f"[Trợ lý AI] Cập nhật kết quả {round_config.get('name')} cho {len(updated)} thí sinh.",
            actor,
        )
    return {
        "success": bool(updated) or not skipped,
        "round": round_config.get("name"),
        "updated_count": len(updated),
        "updated": updated,
        "unchanged": unchanged,
        "skipped": skipped,
    }


@register_tool(
    name="exam_list_rooms",
    title="Phòng thi",
    description=(
        "Danh sách phòng thi của một vòng: tên phòng, hình thức, địa điểm/link, sức chứa, số thí sinh đã xếp, "
        "ca coi thi và giám thị. Chỉ xem, không xếp phòng."
    ),
    module="examination",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "session_id": {"type": "string"},
            "round_id": {"type": "string"},
            "round_name": {"type": "string"},
        },
        "required": ["session_id"],
        "additionalProperties": False,
    },
)
def exam_list_rooms(ctx: Dict[str, Any], session_id: str, round_id: str = "", round_name: str = "", **_kwargs: Any) -> Dict[str, Any]:
    session, round_config, error = _session_and_round(session_id, round_id, round_name)
    if error:
        return {"success": False, "error": error}
    rooms = (
        ExamRoom.objects.filter(session=session, round_id=str(round_config.get("id")))
        .annotate(assigned=Count("assignments"))
        .order_by("occurrence_id", "position", "room_number")
    )
    shifts: Dict[str, List[ExamInvigilationShift]] = {}
    for shift in ExamInvigilationShift.objects.filter(session=session, exam_room__in=rooms).prefetch_related("invigilators"):
        shifts.setdefault(str(shift.exam_room_id), []).append(shift)
    unassigned = _round_results(session, round_config).filter(exam_room__isnull=True).count()
    rows = []
    for room in rooms:
        room_shifts = shifts.get(str(room.id), [])
        rows.append({
            "room_id": str(room.id),
            "label": room.label,
            "occurrence_id": room.occurrence_id,
            "mode": room.mode,
            "location": room.location,
            "link": room.link,
            "capacity": room.capacity,
            "assigned": room.assigned,
            "shifts": [
                {
                    "starts_at": timezone.localtime(s.starts_at).strftime("%d/%m/%Y %H:%M"),
                    "ends_at": timezone.localtime(s.ends_at).strftime("%H:%M"),
                    "invigilators": [p.name or p.email for p in s.invigilators.all()] or ([s.guest_name] if s.guest_name else []),
                }
                for s in room_shifts
            ],
        })
    return {
        "session": session.name,
        "round": round_config.get("name"),
        "room_count": len(rows),
        "candidates_without_room": unassigned,
        "rooms": rows,
    }


@register_tool(
    name="exam_billing_overview",
    title="Đối soát lệ phí khảo thí",
    description=(
        "Tổng quan đối soát lệ phí khảo thí (giống trang Đối soát khảo thí): số hồ sơ chờ chuyển khoản, chờ hóa đơn, "
        "đã xong, tổng tiền và đã thu; kèm danh sách hồ sơ lọc theo trạng thái hoặc tên/mã/trường. Chỉ xem."
    ),
    module="finance-report",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "scope": {"type": "string", "enum": ["active", "past", "all"], "description": "Kỳ đang diễn ra (mặc định), đã qua, hoặc tất cả"},
            "status": {"type": "string", "enum": ["all", "awaiting_transfer", "awaiting_invoice", "completed"]},
            "query": {"type": "string", "description": "Tên thí sinh/trường, mã FT, mã cuộc thi"},
            "limit": {"type": "integer", "description": "Tối đa (mặc định 100)"},
        },
        "additionalProperties": False,
    },
)
def exam_billing_overview(ctx: Dict[str, Any], scope: str = "active", status: str = "all", query: str = "",
                          limit: int = 100, **_kwargs: Any) -> Dict[str, Any]:
    from examination.billing_views import billing_payload, scoped_billing_rows

    try:
        rows = scoped_billing_rows(SimpleNamespace(query_params={"scope": scope or "active"}))
    except ValueError as exc:
        return {"success": False, "error": str(exc)}
    settled = {"checked", "not_required"}

    def state(x) -> str:
        if x.transfer_status != "confirmed":
            return "awaiting_transfer"
        return "completed" if x.invoice_status in settled else "awaiting_invoice"

    stats = {
        "total": len(rows),
        "awaiting_transfer": sum(state(x) == "awaiting_transfer" for x in rows),
        "awaiting_invoice": sum(state(x) == "awaiting_invoice" for x in rows),
        "completed": sum(state(x) == "completed" for x in rows),
        "new_for_accountant": sum(not x.seen_by_accountant for x in rows),
        "total_amount": sum(int(x.amount or 0) for x in rows),
        "collected_amount": sum(int(x.amount or 0) for x in rows if x.transfer_status == "confirmed"),
    }
    selected = [x for x in rows if status in ("", "all") or state(x) == status]
    items = []
    q = query.strip().casefold()
    cap = max(1, min(int(limit or 100), 500))
    for x in selected:
        payload = billing_payload(x)
        if q and q not in " ".join(str(payload.get(k) or "") for k in ("candidateName", "candidateCode", "competitionCode", "school")).casefold():
            continue
        items.append({
            "kind": payload["kind"],
            "name": payload["candidateName"],
            "candidate_code": payload["candidateCode"],
            "candidate_count": payload["candidateCount"],
            "competition": payload["competitionCode"],
            "session": payload["competitionName"],
            "amount": payload["amount"],
            "state": state(x),
            "transfer_reference": payload["transferReference"],
            "invoice_number": payload["invoiceNumber"],
            "proof_count": len(payload["proofs"]),
            "note": payload["note"],
        })
        if len(items) >= cap:
            break
    return {"scope": scope, "stats": stats, "returned": len(items), "records": items}
