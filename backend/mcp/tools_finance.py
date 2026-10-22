from __future__ import annotations

from typing import Any, Dict, Optional
from django.db.models import Sum

from digital_training.models import TrainingFinanceEntry, TrainingPartner
from .registry import register_tool


@register_tool(
    name="finance_get_overview",
    description="Xem báo cáo tổng quan dòng tiền thu chi của Đào tạo số (Tổng thu, tổng chi, số dư, số giao dịch). Chỉ dành cho Kế toán hoặc Quản trị viên (Admin).",
    module="finance-report",
    min_role="EMPLOYEE",
    require_finance=True,
    parameters={
        "type": "object",
        "properties": {
            "date_from": {"type": "string", "description": "Từ ngày (YYYY-MM-DD)"},
            "date_to": {"type": "string", "description": "Đến ngày (YYYY-MM-DD)"},
        },
        "additionalProperties": False,
    },
)
def finance_get_overview(ctx: Dict[str, Any], date_from: Optional[str] = None, date_to: Optional[str] = None, **_kwargs) -> Dict[str, Any]:
    qs = TrainingFinanceEntry.objects.all()
    if date_from:
        qs = qs.filter(transaction_date__gte=date_from)
    if date_to:
        qs = qs.filter(transaction_date__lte=date_to)

    total_income = qs.filter(entry_type="income", status="completed").aggregate(Sum("amount"))["amount__sum"] or 0
    total_expense = qs.filter(entry_type="expense", status="completed").aggregate(Sum("amount"))["amount__sum"] or 0
    pending_income = qs.filter(entry_type="income", status="pending").aggregate(Sum("amount"))["amount__sum"] or 0
    pending_expense = qs.filter(entry_type="expense", status="pending").aggregate(Sum("amount"))["amount__sum"] or 0

    return {
        "time_window": f"{date_from or 'toàn bộ'} đến {date_to or 'hiện tại'}",
        "completed": {
            "total_income": float(total_income),
            "total_expense": float(total_expense),
            "net_balance": float(total_income - total_expense),
        },
        "pending": {
            "pending_income": float(pending_income),
            "pending_expense": float(pending_expense),
        },
        "total_records": qs.count(),
    }


@register_tool(
    name="finance_list_entries",
    description="Tra cứu các bản ghi thu chi, đối soát thanh toán khách hàng (có thể lọc theo đối tác, loại thu/chi, trạng thái). Chỉ dành cho Kế toán và Admin.",
    module="finance-report",
    min_role="EMPLOYEE",
    require_finance=True,
    parameters={
        "type": "object",
        "properties": {
            "entry_type": {
                "type": "string",
                "enum": ["all", "income", "expense"],
                "description": "Loại: 'income' (Thu) hoặc 'expense' (Chi)",
            },
            "partner_id": {"type": "integer", "description": "ID khách hàng/đối tác"},
            "status": {
                "type": "string",
                "enum": ["all", "completed", "pending", "overdue", "cancelled"],
                "description": "Trạng thái giao dịch",
            },
            "search": {"type": "string", "description": "Từ khóa tìm kiếm (mô tả, danh mục, mã tham chiếu)"},
        },
        "additionalProperties": False,
    },
)
def finance_list_entries(
    ctx: Dict[str, Any],
    entry_type: str = "all",
    partner_id: Optional[int] = None,
    status: str = "all",
    search: str = "",
    **_kwargs,
) -> Dict[str, Any]:
    qs = TrainingFinanceEntry.objects.select_related("partner").all()
    if entry_type in {"income", "expense"}:
        qs = qs.filter(entry_type=entry_type)
    if partner_id:
        qs = qs.filter(partner_id=partner_id)
    if status != "all":
        qs = qs.filter(status=status)
    if search:
        qs = qs.filter(description__icontains=search) | qs.filter(category__icontains=search) | qs.filter(reference_code__icontains=search)

    entries = []
    for item in qs.order_by("-transaction_date", "-id")[:50]:
        entries.append({
            "id": item.id,
            "date": item.transaction_date.isoformat(),
            "type": item.entry_type,
            "category": item.category,
            "description": item.description,
            "amount": float(item.amount),
            "partner_name": item.partner.name if item.partner else "",
            "status": item.status,
            "payment_method": item.payment_method,
            "reference_code": item.reference_code,
        })

    return {
        "count": len(entries),
        "entries": entries,
    }


@register_tool(
    name="finance_create_entry",
    description="Lập một khoản thu hoặc chi gắn với đối tác khách hàng (Chỉ dành cho Kế toán hoặc Admin).",
    module="finance-report",
    min_role="EMPLOYEE",
    require_finance=True,
    audit_action="Lập giao dịch thu chi",
    parameters={
        "type": "object",
        "properties": {
            "transaction_date": {"type": "string", "description": "Ngày giao dịch (YYYY-MM-DD)"},
            "entry_type": {"type": "string", "enum": ["income", "expense"], "description": "Loại: 'income' (Thu) hoặc 'expense' (Chi)"},
            "category": {"type": "string", "description": "Danh mục (ví dụ: 'Thu phí bản quyền BNDC', 'Chi thù lao giảng viên')"},
            "description": {"type": "string", "description": "Mô tả chi tiết giao dịch"},
            "amount": {"type": "number", "description": "Số tiền (VNĐ)"},
            "partner_id": {"type": "integer", "description": "ID khách hàng/đối tác (nếu có)"},
            "payment_method": {"type": "string", "description": "Phương thức (Chuyển khoản, Tiền mặt)"},
            "reference_code": {"type": "string", "description": "Mã ủy nhiệm chi / số hóa đơn"},
            "status": {"type": "string", "enum": ["completed", "pending"], "description": "Trạng thái giao dịch (mặc định 'completed')"},
        },
        "required": ["transaction_date", "entry_type", "category", "description", "amount"],
        "additionalProperties": False,
    },
)
def finance_create_entry(
    ctx: Dict[str, Any],
    transaction_date: str,
    entry_type: str,
    category: str,
    description: str,
    amount: float,
    partner_id: Optional[int] = None,
    payment_method: str = "Chuyển khoản",
    reference_code: str = "",
    status: str = "completed",
    **_kwargs,
) -> Dict[str, Any]:
    partner = None
    if partner_id:
        partner = TrainingPartner.objects.filter(pk=partner_id).first()

    entry = TrainingFinanceEntry.objects.create(
        transaction_date=transaction_date,
        entry_type=entry_type,
        category=category.strip(),
        description=description.strip(),
        amount=amount,
        partner=partner,
        payment_method=payment_method,
        reference_code=reference_code,
        status=status,
        created_by=ctx["email"],
        updated_by=ctx["email"],
    )

    return {
        "success": True,
        "message": f"Đã lập giao dịch {entry_type} số tiền {amount:,.0f} VNĐ cho '{category}'.",
        "entry_id": entry.id,
    }


@register_tool(
    name="finance_export_entries",
    description="Xuất (export) sổ cái thu chi, dòng tiền Đào tạo số ra CSV (UTF-8 BOM tải vào Excel) hoặc JSON phục vụ báo cáo tài chính, thuế và kế toán. Chỉ dành cho Kế toán và Admin.",
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
            "date_from": {"type": "string", "description": "Từ ngày (YYYY-MM-DD)"},
            "date_to": {"type": "string", "description": "Đến ngày (YYYY-MM-DD)"},
            "partner_id": {"type": "integer", "description": "ID khách hàng/đối tác"},
            "status": {
                "type": "string",
                "enum": ["all", "completed", "pending", "overdue", "cancelled"],
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
    if date_from:
        qs = qs.filter(transaction_date__gte=date_from)
    if date_to:
        qs = qs.filter(transaction_date__lte=date_to)
    if partner_id:
        qs = qs.filter(partner_id=partner_id)
    if status != "all":
        qs = qs.filter(status=status)

    items = []
    for it in qs.order_by("transaction_date", "id")[:1000]:
        items.append({
            "id": it.id,
            "date": it.transaction_date.isoformat(),
            "type": it.entry_type,
            "category": it.category,
            "description": it.description,
            "amount": float(it.amount),
            "partner_name": it.partner.name if it.partner else "",
            "payment_method": it.payment_method,
            "reference_code": it.reference_code or "",
            "status": it.status,
            "created_by": it.created_by,
        })

    if format == "csv":
        import csv
        import io
        out = io.StringIO()
        out.write("\ufeff")  # UTF-8 BOM
        writer = csv.writer(out)
        writer.writerow([
            "STT", "Mã GD", "Ngày giao dịch", "Loại", "Danh mục", "Mô tả / Diễn giải",
            "Số tiền (VNĐ)", "Khách hàng / Đối tác", "Hình thức thanh toán", "Mã tham chiếu / Hóa đơn", "Trạng thái", "Người tạo",
        ])
        for idx, it in enumerate(items, 1):
            writer.writerow([
                idx, it["id"], it["date"], "Thu" if it["type"] == "income" else "Chi",
                it["category"], it["description"], f"{it['amount']:,.0f}",
                it["partner_name"], it["payment_method"], it["reference_code"],
                it["status"], it["created_by"],
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
        "entries": items,
    }

