"""Công cụ MCP bổ sung cho quản lý khách hàng: sửa hồ sơ, lịch gặp, tổng quan pipeline."""
from __future__ import annotations

import datetime
from typing import Any, Dict, List, Optional

from django.db.models import Count, Q
from django.db.models.functions import Coalesce
from django.utils import timezone

from digital_training.models import (
    TrainingCustomerMeeting,
    TrainingLead,
    TrainingPartner,
    TrainingPartnerAiAccount,
    TrainingProductSubscription,
)
from digital_training.serializers import TrainingPartnerSerializer

from digital_training.finance_division import FINANCE_NOTE_REDIRECT, looks_like_finance_record

from .lookups import find_partner
from .registry import register_tool

EDITABLE_PARTNER_FIELDS = (
    "address",
    "province",
    "ward",
    "contact_person",
    "contact_position",
    "phone",
    "email",
    "contract_status",
    "training_location",
    "training_staff",
)


def _parse_date(value: Any) -> Optional[datetime.date]:
    try:
        return datetime.date.fromisoformat(str(value or "").strip()[:10])
    except ValueError:
        return None


@register_tool(
    name="crm_update_customer",
    title="Cập nhật hồ sơ khách hàng",
    description=(
        "Cập nhật thông tin liên hệ, địa chỉ, trạng thái hợp đồng của khách hàng hiện tại; thêm đầu mối liên hệ "
        "hoặc thêm ghi chú chăm sóc (ghi chú được nối thêm kèm ngày và người ghi, không ghi đè ghi chú cũ). "
        "Chỉ gửi những trường cần đổi; trường để trống không bị xóa. "
        "KHÔNG dùng để ghi doanh thu, khoản thu, chi phí hay thanh toán: những việc đó dùng finance_create_entry "
        "(Báo cáo thu chi /finance-report)."
    ),
    module="digital-training",
    min_role="MANAGER",
    audit_action="Cập nhật hồ sơ khách hàng",
    parameters={
        "type": "object",
        "properties": {
            "partner_id": {"type": "integer", "description": "ID khách hàng (ưu tiên)"},
            "partner_name": {"type": "string", "description": "Tên khách hàng nếu không có ID"},
            "address": {"type": "string"},
            "province": {"type": "string"},
            "ward": {"type": "string"},
            "contact_person": {"type": "string", "description": "Người liên hệ chính"},
            "contact_position": {"type": "string"},
            "phone": {"type": "string"},
            "email": {"type": "string"},
            "contract_status": {"type": "string", "description": "Trạng thái hợp đồng, vd 'signed', 'negotiating', 'expired'"},
            "training_location": {"type": "string"},
            "training_staff": {"type": "string"},
            "add_contact": {
                "type": "object",
                "description": "Thêm một đầu mối liên hệ phụ",
                "properties": {
                    "contact_person": {"type": "string"},
                    "position": {"type": "string"},
                    "phone": {"type": "string"},
                    "email": {"type": "string"},
                },
                "additionalProperties": False,
            },
            "append_note": {
                "type": "string",
                "description": "Ghi chú chăm sóc khách hàng cần nối thêm. Không dùng cho doanh thu/thu chi.",
            },
            "not_finance_record": {
                "type": "boolean",
                "description": "true chỉ khi người dùng nói rõ ghi chú có số tiền này KHÔNG phải khoản thu chi",
            },
        },
        "additionalProperties": False,
    },
)
def crm_update_customer(
    ctx: Dict[str, Any],
    partner_id: Optional[int] = None,
    partner_name: str = "",
    add_contact: Optional[Dict[str, Any]] = None,
    append_note: str = "",
    not_finance_record: bool = False,
    **fields: Any,
) -> Dict[str, Any]:
    if append_note and not not_finance_record and looks_like_finance_record(append_note):
        return {"success": False, "error": FINANCE_NOTE_REDIRECT, "use_tool": "finance_create_entry"}

    partner, error = find_partner(partner_id, partner_name)
    if not partner:
        return {"success": False, "error": error}

    data: Dict[str, Any] = {}
    for key in EDITABLE_PARTNER_FIELDS:
        value = fields.get(key)
        if value is not None and str(value).strip():
            data[key] = str(value).strip()

    if add_contact:
        contacts = list(partner.additional_contacts or [])
        contacts.append(add_contact)
        data["additional_contacts"] = contacts

    note = str(append_note or "").strip()
    if note:
        stamp = timezone.localtime().strftime("%d/%m/%Y")
        author = ctx.get("name") or ctx.get("email") or "MCP"
        line = f"[{stamp} – {author}] {note}"
        data["notes"] = f"{partner.notes.rstrip()}\n{line}" if partner.notes.strip() else line

    if not data:
        return {"success": False, "error": "Không có thông tin nào cần cập nhật."}

    serializer = TrainingPartnerSerializer(partner, data=data, partial=True)
    if not serializer.is_valid():
        return {"success": False, "error": "Dữ liệu không hợp lệ.", "details": serializer.errors}
    serializer.save()
    return {
        "success": True,
        "message": f"Đã cập nhật khách hàng '{partner.name}'.",
        "updated_fields": sorted(data.keys()),
        "customer_id": partner.id,
    }


@register_tool(
    name="crm_list_meetings",
    title="Lịch gặp khách hàng",
    description=(
        "Liệt kê lịch gặp khách hàng và hoạt động chăm sóc trong một khoảng ngày (mặc định từ hôm nay đến 14 ngày tới). "
        "Lọc theo khách hàng, nhân viên phụ trách hoặc trạng thái."
    ),
    module="digital-training",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "date_from": {"type": "string", "description": "YYYY-MM-DD, mặc định hôm nay"},
            "date_to": {"type": "string", "description": "YYYY-MM-DD, mặc định 14 ngày sau date_from"},
            "partner_id": {"type": "integer"},
            "partner_name": {"type": "string", "description": "Tên khách hàng hoặc khách hàng mới"},
            "staff": {"type": "string", "description": "Tên nhân viên phụ trách"},
            "status": {"type": "string", "enum": ["all", "planned", "completed", "cancelled"]},
        },
        "additionalProperties": False,
    },
)
def crm_list_meetings(
    ctx: Dict[str, Any],
    date_from: str = "",
    date_to: str = "",
    partner_id: Optional[int] = None,
    partner_name: str = "",
    staff: str = "",
    status: str = "all",
    **_kwargs: Any,
) -> Dict[str, Any]:
    start = _parse_date(date_from) or timezone.localdate()
    end = _parse_date(date_to) or start + datetime.timedelta(days=14)
    if end < start:
        start, end = end, start

    qs = TrainingCustomerMeeting.objects.select_related("partner", "lead").filter(meeting_date__range=(start, end))
    if partner_id:
        qs = qs.filter(partner_id=partner_id)
    elif partner_name.strip():
        name = partner_name.strip()
        qs = qs.filter(Q(partner__name__icontains=name) | Q(lead__name__icontains=name) | Q(title__icontains=name))
    if staff.strip():
        qs = qs.filter(staff_name__icontains=staff.strip())
    if status and status != "all":
        qs = qs.filter(status=status)

    meetings: List[Dict[str, Any]] = []
    for m in qs.order_by("meeting_date", "start_time")[:200]:
        meetings.append({
            "id": m.id,
            "title": m.title,
            "date": m.meeting_date.isoformat(),
            "start_time": m.start_time.strftime("%H:%M") if m.start_time else "",
            "end_time": m.end_time.strftime("%H:%M") if m.end_time else "",
            "customer": m.partner.name if m.partner else (m.lead.name if m.lead else ""),
            "customer_kind": "partner" if m.partner_id else ("lead" if m.lead_id else ""),
            "representative": m.representative,
            "phone": m.phone,
            "location": m.location,
            "staff": m.staff_name,
            "status": m.status,
            "content": m.content,
        })
    return {"date_from": start.isoformat(), "date_to": end.isoformat(), "count": len(meetings), "meetings": meetings}


@register_tool(
    name="crm_pipeline_overview",
    title="Tổng quan khách hàng",
    description=(
        "Tổng quan quản lý khách hàng: số khách hàng mới theo giai đoạn, số khách hàng hiện tại, dịch vụ sắp hết hạn "
        "hoặc đã hết hạn, tài khoản AI sắp hết hạn, lịch gặp 7 ngày tới. Dùng để lập kế hoạch chăm sóc và gia hạn."
    ),
    module="digital-training",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "days_ahead": {"type": "integer", "description": "Số ngày tới để xét sắp hết hạn (mặc định 30)"},
        },
        "additionalProperties": False,
    },
)
def crm_pipeline_overview(ctx: Dict[str, Any], days_ahead: int = 30, **_kwargs: Any) -> Dict[str, Any]:
    today = timezone.localdate()
    days = max(1, min(int(days_ahead or 30), 365))
    horizon = today + datetime.timedelta(days=days)

    stage_labels = dict(TrainingLead.STAGE_CHOICES)
    leads_by_stage = {
        row["stage"]: {"label": stage_labels.get(row["stage"], row["stage"]), "count": row["n"]}
        for row in TrainingLead.objects.values("stage").annotate(n=Count("id"))
    }

    # Cùng quy tắc với web và thông báo hết hạn: hạn thực tế, thiếu thì theo hợp đồng; chỉ xét gói đang dùng.
    live_subs = (
        TrainingProductSubscription.objects.select_related("partner", "product")
        .filter(status="active")
        .annotate(effective_expiry=Coalesce("expires_at", "contract_expires_at"))
    )
    expiring = live_subs.filter(effective_expiry__gte=today, effective_expiry__lte=horizon).order_by("effective_expiry")
    expired = live_subs.filter(effective_expiry__lt=today).order_by("-effective_expiry")

    def sub_row(s: TrainingProductSubscription) -> Dict[str, Any]:
        return {
            "subscription_id": s.id,
            "customer": s.partner.name,
            "customer_id": s.partner_id,
            "product": s.product.name,
            "expires_at": s.effective_expiry.isoformat() if s.effective_expiry else None,
            "days_remaining": (s.effective_expiry - today).days if s.effective_expiry else None,
            "account_manager": s.account_manager,
        }

    ai_expiring = (
        TrainingPartnerAiAccount.objects.select_related("partner")
        .filter(status="active", expires_at__isnull=False, expires_at__lte=horizon)
        .order_by("expires_at")
    )

    week_end = today + datetime.timedelta(days=7)
    upcoming = TrainingCustomerMeeting.objects.filter(meeting_date__range=(today, week_end), status="planned").count()

    return {
        "as_of": today.isoformat(),
        "days_ahead": days,
        "partners_total": TrainingPartner.objects.count(),
        "leads_total": TrainingLead.objects.exclude(stage__in=["converted", "lost"]).count(),
        "leads_by_stage": leads_by_stage,
        "subscriptions_expiring_count": expiring.count(),
        "subscriptions_expiring": [sub_row(s) for s in expiring[:30]],
        "subscriptions_expired_count": expired.count(),
        "subscriptions_expired": [sub_row(s) for s in expired[:30]],
        "ai_accounts_expiring_count": ai_expiring.count(),
        "ai_accounts_expiring": [
            {
                "id": a.id,
                "customer": a.partner.name,
                "platform": a.get_platform_display(),
                "account_username": a.account_username,
                "expires_at": a.expires_at.isoformat(),
                "days_remaining": (a.expires_at - today).days,
            }
            for a in ai_expiring[:30]
        ],
        "meetings_next_7_days": upcoming,
    }
