"""Công cụ MCP cho Báo cáo thu chi (https://workspace.fermat.vn/finance-report).

Mọi khoản doanh thu / thu / chi đều ghi vào sổ thu chi `TrainingFinanceEntry`, có cột Mảng:
- examination: Khảo thí (cuộc thi/kỳ thi, lệ phí dự thi, coi thi, đề thi, giải thưởng)
- digital_training: Công nghệ số & Đào tạo (hợp đồng khách hàng, BNDC, tài khoản AI, khóa đào tạo)
Không rõ mảng thì không đoán: trả câu hỏi để AI hỏi lại người dùng.
"""
from __future__ import annotations

import datetime
from typing import Any, Dict, Optional

from django.db.models import Q, Sum

from digital_training.finance_division import (
    DIVISION_LABELS,
    classify_division,
    division_question,
)
from digital_training.models import TrainingFinanceEntry
from digital_training.serializers import TrainingFinanceEntrySerializer

from .lookups import find_partner
from .registry import register_tool

DIVISION_PARAM = {
    "type": "string",
    "enum": ["examination", "digital_training"],
    "description": (
        "Mảng của khoản thu chi. 'examination' = Khảo thí: gắn với cuộc thi/kỳ thi (FIMO, FIEO, SIAIO, SCO…), "
        "lệ phí dự thi, coi thi, phòng thi, đề thi, giải thưởng. 'digital_training' = Công nghệ số & Đào tạo: "
        "hợp đồng khách hàng/trường đối tác, BNDC, tài khoản AI, khóa đào tạo, giảng viên. "
        "Người dùng không nói rõ và nội dung không chỉ rõ thì PHẢI hỏi lại người dùng, không tự chọn."
    ),
}
DIVISION_FILTER_PARAM = {
    "type": "string",
    "enum": ["all", "examination", "digital_training"],
    "description": "Lọc theo mảng: 'examination' (Khảo thí), 'digital_training' (Công nghệ số & Đào tạo), 'all' (cả hai)",
}
STATUS_VALUES = ["pending", "completed", "overdue", "cancelled"]


def _division_filter(qs, division: Optional[str]):
    if division in DIVISION_LABELS:
        return qs.filter(division=division)
    return qs


def _entry_dict(item: TrainingFinanceEntry) -> Dict[str, Any]:
    return {
        "id": item.id,
        "date": item.transaction_date.isoformat(),
        "type": item.entry_type,
        "division": item.division,
        "division_label": DIVISION_LABELS.get(item.division, item.division),
        "category": item.category,
        "description": item.description,
        "amount": float(item.amount),
        "partner_id": item.partner_id,
        "partner_name": item.partner.name if item.partner else "",
        "status": item.status,
        "payment_method": item.payment_method,
        "reference_code": item.reference_code or "",
        "notes": item.notes or "",
        "created_by": item.created_by,
    }


def _totals(qs) -> Dict[str, float]:
    def total(entry_type: str, status: str) -> float:
        return float(qs.filter(entry_type=entry_type, status=status).aggregate(s=Sum("amount"))["s"] or 0)

    income, expense = total("income", "completed"), total("expense", "completed")
    return {
        "total_income": income,
        "total_expense": expense,
        "net_balance": income - expense,
        "pending_income": total("income", "pending"),
        "pending_expense": total("expense", "pending"),
    }


def resolve_division(
    division: Optional[str],
    division_confirmed: bool,
    *texts: str,
) -> Dict[str, Any]:
    """Chọn mảng cho khoản thu chi. Trả {'division': ...} hoặc {'question': ...} khi phải hỏi người dùng."""
    guess, exam_hits, training_hits = classify_division(*texts)
    if division in DIVISION_LABELS:
        # AI chọn một mảng nhưng nội dung chỉ rõ mảng kia: hỏi lại trước khi ghi.
        if guess and guess != division and not division_confirmed:
            hits = exam_hits if guess == "examination" else training_hits
            return {
                "question": (
                    f"Bạn chọn mảng {DIVISION_LABELS[division]}, nhưng nội dung có dấu hiệu của "
                    f"{DIVISION_LABELS[guess]} ({', '.join(hits)}). Hãy hỏi người dùng xác nhận mảng; "
                    "nếu người dùng giữ nguyên thì gọi lại với division_confirmed=true."
                ),
                "suggested_division": guess,
            }
        return {"division": division}
    if guess:
        return {"division": guess, "auto": True}
    return {"question": division_question(exam_hits, training_hits)}


@register_tool(
    name="finance_get_overview",
    title="Tổng quan thu chi",
    description=(
        "Xem tổng thu, tổng chi, chênh lệch và khoản đang chờ của Báo cáo thu chi (/finance-report), "
        "tách riêng Khảo thí và Công nghệ số & Đào tạo. Dùng khi hỏi doanh thu/chi phí/lãi lỗ. "
        "Chỉ dành cho Kế toán hoặc Admin."
    ),
    module="finance-report",
    min_role="EMPLOYEE",
    require_finance=True,
    parameters={
        "type": "object",
        "properties": {
            "date_from": {"type": "string", "description": "Từ ngày (YYYY-MM-DD)"},
            "date_to": {"type": "string", "description": "Đến ngày (YYYY-MM-DD)"},
            "division": DIVISION_FILTER_PARAM,
        },
        "additionalProperties": False,
    },
)
def finance_get_overview(
    ctx: Dict[str, Any],
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    division: str = "all",
    **_kwargs,
) -> Dict[str, Any]:
    qs = TrainingFinanceEntry.objects.all()
    if date_from:
        qs = qs.filter(transaction_date__gte=date_from)
    if date_to:
        qs = qs.filter(transaction_date__lte=date_to)
    qs = _division_filter(qs, division)

    totals = _totals(qs)
    return {
        "time_window": f"{date_from or 'toàn bộ'} đến {date_to or 'hiện tại'}",
        "division": DIVISION_LABELS.get(division, "Cả hai mảng"),
        "completed": {key: totals[key] for key in ("total_income", "total_expense", "net_balance")},
        "pending": {key: totals[key] for key in ("pending_income", "pending_expense")},
        "by_division": {
            code: {"label": label, **_totals(qs.filter(division=code))}
            for code, label in DIVISION_LABELS.items()
            if division not in DIVISION_LABELS or division == code
        },
        "total_records": qs.count(),
    }


@register_tool(
    name="finance_list_entries",
    title="Tra cứu khoản thu chi",
    description=(
        "Tra cứu các khoản thu/chi (doanh thu, chi phí, công nợ) trong Báo cáo thu chi, lọc theo mảng "
        "(Khảo thí / Công nghệ số & Đào tạo), loại, trạng thái, khách hàng, khoảng ngày hoặc từ khóa. "
        "Chỉ dành cho Kế toán và Admin."
    ),
    module="finance-report",
    min_role="EMPLOYEE",
    require_finance=True,
    parameters={
        "type": "object",
        "properties": {
            "entry_type": {
                "type": "string",
                "enum": ["all", "income", "expense"],
                "description": "Loại: 'income' (Thu/doanh thu) hoặc 'expense' (Chi)",
            },
            "division": DIVISION_FILTER_PARAM,
            "partner_id": {"type": "integer", "description": "ID khách hàng/đối tác"},
            "status": {
                "type": "string",
                "enum": ["all", *STATUS_VALUES],
                "description": "Trạng thái giao dịch",
            },
            "date_from": {"type": "string", "description": "Từ ngày (YYYY-MM-DD)"},
            "date_to": {"type": "string", "description": "Đến ngày (YYYY-MM-DD)"},
            "search": {"type": "string", "description": "Từ khóa (nội dung, nhóm thu chi, mã chứng từ, tên khách hàng, ghi chú)"},
            "limit": {"type": "integer", "description": "Số dòng tối đa (mặc định 50, tối đa 500)"},
        },
        "additionalProperties": False,
    },
)
def finance_list_entries(
    ctx: Dict[str, Any],
    entry_type: str = "all",
    division: str = "all",
    partner_id: Optional[int] = None,
    status: str = "all",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: str = "",
    limit: int = 50,
    **_kwargs,
) -> Dict[str, Any]:
    qs = TrainingFinanceEntry.objects.select_related("partner").all()
    if entry_type in {"income", "expense"}:
        qs = qs.filter(entry_type=entry_type)
    qs = _division_filter(qs, division)
    if partner_id:
        qs = qs.filter(partner_id=partner_id)
    if status in STATUS_VALUES:
        qs = qs.filter(status=status)
    if date_from:
        qs = qs.filter(transaction_date__gte=date_from)
    if date_to:
        qs = qs.filter(transaction_date__lte=date_to)
    search = str(search or "").strip()
    if search:
        qs = qs.filter(
            Q(description__icontains=search) | Q(category__icontains=search) | Q(reference_code__icontains=search)
            | Q(partner__name__icontains=search) | Q(notes__icontains=search)
        )
    limit = max(1, min(int(limit or 50), 500))
    entries = [_entry_dict(item) for item in qs.order_by("-transaction_date", "-id")[:limit]]
    return {"count": len(entries), "total_matching": qs.count(), "entries": entries}


@register_tool(
    name="finance_create_entry",
    title="Nhập doanh thu / khoản thu chi",
    description=(
        "Nhập doanh thu, khoản thu hoặc khoản chi vào Báo cáo thu chi (https://workspace.fermat.vn/finance-report). "
        "Đây là công cụ DUY NHẤT để ghi doanh thu/thu/chi; KHÔNG ghi doanh thu vào ghi chú khách hàng "
        "(crm_update_customer) hay ghi chú lead. Phải xác định mảng: Khảo thí (cuộc thi/kỳ thi, lệ phí dự thi, "
        "coi thi, đề thi, giải thưởng) hay Công nghệ số & Đào tạo (hợp đồng khách hàng, BNDC, tài khoản AI, "
        "khóa đào tạo). Không rõ thì công cụ trả về 'needs_user_input' kèm câu hỏi: hãy hỏi người dùng rồi gọi lại. "
        "Lệ phí dự thi của từng thí sinh/trường đã có ở tab Đối soát khảo thí, không nhập trùng ở đây. "
        "Chỉ dành cho Kế toán hoặc Admin."
    ),
    module="finance-report",
    min_role="EMPLOYEE",
    require_finance=True,
    audit_action="Lập giao dịch thu chi",
    parameters={
        "type": "object",
        "properties": {
            "transaction_date": {"type": "string", "description": "Ngày giao dịch (YYYY-MM-DD). Không có thì lấy hôm nay."},
            "entry_type": {"type": "string", "enum": ["income", "expense"], "description": "'income' = Thu/doanh thu, 'expense' = Chi"},
            "division": DIVISION_PARAM,
            "division_confirmed": {
                "type": "boolean",
                "description": "true khi người dùng đã xác nhận mảng sau câu hỏi của công cụ",
            },
            "category": {"type": "string", "description": "Nhóm thu chi (vd 'Doanh thu hợp đồng', 'Lệ phí thi FIMO', 'Chi thù lao giảng viên')"},
            "description": {"type": "string", "description": "Nội dung / diễn giải khoản thu chi"},
            "amount": {"type": "number", "description": "Số tiền dương (VNĐ)"},
            "partner_id": {"type": "integer", "description": "ID khách hàng/đối tác (nếu có)"},
            "partner_name": {"type": "string", "description": "Tên khách hàng nếu không có ID"},
            "payment_method": {"type": "string", "description": "Phương thức (Chuyển khoản, Tiền mặt)"},
            "reference_code": {"type": "string", "description": "Mã chứng từ / số hóa đơn / mã ủy nhiệm chi"},
            "status": {"type": "string", "enum": STATUS_VALUES, "description": "Trạng thái (mặc định 'completed' = đã thu/chi xong)"},
            "notes": {"type": "string", "description": "Ghi chú của khoản thu chi"},
        },
        "required": ["entry_type", "category", "description", "amount"],
        "additionalProperties": False,
    },
)
def finance_create_entry(
    ctx: Dict[str, Any],
    entry_type: str,
    category: str,
    description: str,
    amount: float,
    transaction_date: str = "",
    division: str = "",
    division_confirmed: bool = False,
    partner_id: Optional[int] = None,
    partner_name: str = "",
    payment_method: str = "Chuyển khoản",
    reference_code: str = "",
    status: str = "completed",
    notes: str = "",
    **_kwargs,
) -> Dict[str, Any]:
    partner = None
    if partner_id or str(partner_name or "").strip():
        partner, error = find_partner(partner_id, partner_name)
        if not partner:
            return {"success": False, "error": error}

    decision = resolve_division(
        division, division_confirmed, category, description, notes, partner.name if partner else "",
    )
    if "question" in decision:
        return {
            "success": False,
            "needs_user_input": "division",
            "question": decision["question"],
            "suggested_division": decision.get("suggested_division"),
            "options": [{"value": code, "label": label} for code, label in DIVISION_LABELS.items()],
        }

    serializer = TrainingFinanceEntrySerializer(data={
        "transaction_date": str(transaction_date or "").strip()[:10] or datetime.date.today().isoformat(),
        "entry_type": entry_type,
        "division": decision["division"],
        "category": str(category or "").strip(),
        "description": str(description or "").strip(),
        "amount": amount,
        "partner": partner.id if partner else None,
        "payment_method": str(payment_method or "").strip(),
        "reference_code": str(reference_code or "").strip(),
        "status": status,
        "notes": str(notes or "").strip(),
    })
    if not serializer.is_valid():
        return {"success": False, "error": "Dữ liệu không hợp lệ.", "details": serializer.errors}
    entry = serializer.save(created_by=ctx["email"], updated_by=ctx["email"])

    label = DIVISION_LABELS[entry.division]
    kind = "khoản thu" if entry.entry_type == "income" else "khoản chi"
    return {
        "success": True,
        "message": (
            f"Đã ghi {kind} {float(entry.amount):,.0f} VNĐ vào Báo cáo thu chi, mảng {label}"
            f"{' (tự xác định theo nội dung)' if decision.get('auto') else ''}."
        ),
        "entry": _entry_dict(entry),
        "url": "/finance-report",
    }


@register_tool(
    name="finance_update_entry",
    title="Sửa khoản thu chi",
    description=(
        "Sửa một khoản thu chi đã có trong Báo cáo thu chi (số tiền, ngày, mảng, nhóm, nội dung, trạng thái, "
        "chứng từ, khách hàng, ghi chú). Chỉ gửi trường cần đổi. Đổi mảng chỉ khi người dùng nói rõ. "
        "Chỉ dành cho Kế toán hoặc Admin."
    ),
    module="finance-report",
    min_role="EMPLOYEE",
    require_finance=True,
    audit_action="Sửa giao dịch thu chi",
    parameters={
        "type": "object",
        "properties": {
            "entry_id": {"type": "integer", "description": "ID khoản thu chi (lấy từ finance_list_entries)"},
            "transaction_date": {"type": "string", "description": "Ngày giao dịch (YYYY-MM-DD)"},
            "entry_type": {"type": "string", "enum": ["income", "expense"]},
            "division": DIVISION_PARAM,
            "category": {"type": "string"},
            "description": {"type": "string"},
            "amount": {"type": "number"},
            "partner_id": {"type": "integer", "description": "ID khách hàng; 0 để bỏ gắn khách hàng"},
            "partner_name": {"type": "string"},
            "payment_method": {"type": "string"},
            "reference_code": {"type": "string"},
            "status": {"type": "string", "enum": STATUS_VALUES},
            "notes": {"type": "string"},
        },
        "required": ["entry_id"],
        "additionalProperties": False,
    },
)
def finance_update_entry(ctx: Dict[str, Any], entry_id: int, **fields: Any) -> Dict[str, Any]:
    item = TrainingFinanceEntry.objects.select_related("partner").filter(pk=entry_id).first()
    if not item:
        return {"success": False, "error": f"Không có khoản thu chi ID {entry_id}."}

    data: Dict[str, Any] = {}
    for key in ("transaction_date", "entry_type", "division", "category", "description",
                "amount", "payment_method", "reference_code", "status", "notes"):
        value = fields.get(key)
        if value is not None and (not isinstance(value, str) or value.strip() or key in {"notes", "reference_code"}):
            data[key] = value.strip() if isinstance(value, str) else value
    if fields.get("partner_id") == 0:
        data["partner"] = None
    elif fields.get("partner_id") or str(fields.get("partner_name") or "").strip():
        partner, error = find_partner(fields.get("partner_id"), fields.get("partner_name") or "")
        if not partner:
            return {"success": False, "error": error}
        data["partner"] = partner.id
    if not data:
        return {"success": False, "error": "Không có thông tin nào cần cập nhật."}

    serializer = TrainingFinanceEntrySerializer(item, data=data, partial=True)
    if not serializer.is_valid():
        return {"success": False, "error": "Dữ liệu không hợp lệ.", "details": serializer.errors}
    updated = serializer.save(updated_by=ctx["email"])
    return {"success": True, "message": f"Đã cập nhật khoản thu chi ID {updated.id}.",
            "updated_fields": sorted(data.keys()), "entry": _entry_dict(updated)}


@register_tool(
    name="finance_delete_entry",
    title="Xóa khoản thu chi",
    description=(
        "Xóa hẳn một khoản thu chi khỏi Báo cáo thu chi. Phải hỏi người dùng xác nhận trước, rồi gọi với "
        "confirm=true. Muốn giữ lịch sử thì dùng finance_update_entry đặt status='cancelled'. "
        "Chỉ dành cho Kế toán hoặc Admin."
    ),
    module="finance-report",
    min_role="EMPLOYEE",
    require_finance=True,
    audit_action="Xóa giao dịch thu chi",
    destructive=True,
    parameters={
        "type": "object",
        "properties": {
            "entry_id": {"type": "integer", "description": "ID khoản thu chi"},
            "confirm": {"type": "boolean", "description": "true khi người dùng đã xác nhận xóa"},
        },
        "required": ["entry_id"],
        "additionalProperties": False,
    },
)
def finance_delete_entry(ctx: Dict[str, Any], entry_id: int, confirm: bool = False, **_kwargs) -> Dict[str, Any]:
    item = TrainingFinanceEntry.objects.select_related("partner").filter(pk=entry_id).first()
    if not item:
        return {"success": False, "error": f"Không có khoản thu chi ID {entry_id}."}
    if not confirm:
        return {
            "success": False,
            "needs_user_input": "confirm",
            "question": "Hỏi người dùng có chắc muốn xóa khoản này không, rồi gọi lại với confirm=true.",
            "entry": _entry_dict(item),
        }
    snapshot = _entry_dict(item)
    item.delete()
    return {"success": True, "message": f"Đã xóa khoản thu chi ID {entry_id}.", "deleted": snapshot}


@register_tool(
    name="finance_export_entries",
    title="Xuất sổ thu chi",
    description=(
        "Xuất sổ thu chi (Khảo thí và/hoặc Công nghệ số & Đào tạo) ra CSV (UTF-8 BOM, mở được bằng Excel) "
        "hoặc JSON phục vụ báo cáo tài chính, thuế và kế toán. Chỉ dành cho Kế toán và Admin."
    ),
    module="finance-report",
    min_role="EMPLOYEE",
    require_finance=True,
    parameters={
        "type": "object",
        "properties": {
            "entry_type": {
                "type": "string",
                "enum": ["all", "income", "expense"],
                "description": "Lọc theo loại thu chi ('all', 'income', 'expense')",
            },
            "division": DIVISION_FILTER_PARAM,
            "date_from": {"type": "string", "description": "Từ ngày (YYYY-MM-DD)"},
            "date_to": {"type": "string", "description": "Đến ngày (YYYY-MM-DD)"},
            "partner_id": {"type": "integer", "description": "ID khách hàng/đối tác"},
            "status": {
                "type": "string",
                "enum": ["all", *STATUS_VALUES],
                "description": "Trạng thái giao dịch",
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
def finance_export_entries(
    ctx: Dict[str, Any],
    entry_type: str = "all",
    division: str = "all",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    partner_id: Optional[int] = None,
    status: str = "all",
    format: str = "json",
    **_kwargs,
) -> Dict[str, Any]:
    qs = TrainingFinanceEntry.objects.select_related("partner").all()
    if entry_type in {"income", "expense"}:
        qs = qs.filter(entry_type=entry_type)
    qs = _division_filter(qs, division)
    if date_from:
        qs = qs.filter(transaction_date__gte=date_from)
    if date_to:
        qs = qs.filter(transaction_date__lte=date_to)
    if partner_id:
        qs = qs.filter(partner_id=partner_id)
    if status in STATUS_VALUES:
        qs = qs.filter(status=status)

    items = [_entry_dict(it) for it in qs.order_by("transaction_date", "id")[:1000]]

    if format == "csv":
        import csv
        import io

        out = io.StringIO()
        out.write("﻿")  # UTF-8 BOM
        writer = csv.writer(out)
        writer.writerow([
            "STT", "Mã GD", "Ngày giao dịch", "Mảng", "Loại", "Nhóm thu chi", "Nội dung / Diễn giải",
            "Số tiền (VNĐ)", "Khách hàng / Đối tác", "Hình thức thanh toán", "Mã chứng từ / Hóa đơn",
            "Trạng thái", "Ghi chú", "Người tạo",
        ])
        for idx, it in enumerate(items, 1):
            writer.writerow([
                idx, it["id"], it["date"], it["division_label"], "Thu" if it["type"] == "income" else "Chi",
                it["category"], it["description"], f"{it['amount']:,.0f}",
                it["partner_name"], it["payment_method"], it["reference_code"],
                it["status"], it["notes"], it["created_by"],
            ])
        return {"success": True, "format": "csv", "count": len(items), "csv_content": out.getvalue()}

    return {"success": True, "format": "json", "count": len(items), "entries": items}
