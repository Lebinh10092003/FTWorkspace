from __future__ import annotations

from datetime import timedelta
from typing import Any, Dict, List, Optional
from django.db.models import Q
from django.db.models.functions import Coalesce
from django.utils import timezone

from digital_training.models import (
    TrainingCustomerMeeting,
    TrainingLead,
    TrainingPartner,
    TrainingPartnerAiAccount,
    TrainingProduct,
    TrainingProductSubscription,
)
from digital_training.product_service import sync_partner_product_subscriptions
from digital_training.serializers import product_subscription_status
from .registry import register_tool
from .lookups import find_partner


@register_tool(
    name="crm_search_customers",
    description="Tìm kiếm khách hàng (cả Khách hàng mới/Leads và Khách hàng hiện tại/Đối tác) theo tên trường/đơn vị, tỉnh thành, hoặc người liên hệ.",
    module="digital-training",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Tên trường, đơn vị, người liên hệ, SĐT hoặc email",
            },
            "customer_type": {
                "type": "string",
                "enum": ["all", "partner", "lead"],
                "description": "Lọc theo loại: 'all' (tất cả), 'partner' (khách hàng hiện tại), 'lead' (khách hàng mới)",
            },
            "province": {
                "type": "string",
                "description": "Lọc theo tỉnh/thành phố",
            },
        },
        "additionalProperties": False,
    },
)
def crm_search_customers(ctx: Dict[str, Any], query: str = "", customer_type: str = "all", province: str = "", **_kwargs) -> Dict[str, Any]:
    results = []

    # 1. Tìm trong Khách hàng hiện tại (Partners)
    if customer_type in {"all", "partner"}:
        p_qs = TrainingPartner.objects.all()
        if query:
            p_qs = p_qs.filter(
                Q(name__icontains=query)
                | Q(contact_person__icontains=query)
                | Q(phone__icontains=query)
                | Q(email__icontains=query)
                | Q(address__icontains=query)
            )
        if province:
            p_qs = p_qs.filter(Q(province__icontains=province) | Q(address__icontains=province))

        for p in p_qs.order_by("name")[:25]:
            results.append({
                "id": p.id,
                "type": "partner",
                "name": p.name,
                "province": p.province or "",
                "contact_person": p.contact_person,
                "contact_position": p.contact_position,
                "phone": p.phone,
                "email": p.email,
                "contract_status": p.contract_status or "chưa rõ",
                "contract_end": p.contract_end or "",
                "products": p.products or [],
            })

    # 2. Tìm trong Khách hàng mới (Leads)
    if customer_type in {"all", "lead"}:
        l_qs = TrainingLead.objects.all()
        if query:
            l_qs = l_qs.filter(
                Q(name__icontains=query)
                | Q(representative__icontains=query)
                | Q(phone__icontains=query)
                | Q(email__icontains=query)
                | Q(address__icontains=query)
            )
        if province:
            l_qs = l_qs.filter(address__icontains=province)

        for lead in l_qs.order_by("name")[:25]:
            results.append({
                "id": lead.id,
                "type": "lead",
                "name": lead.name,
                "stage": lead.stage,
                "representative": lead.representative,
                "representative_position": lead.representative_position,
                "phone": lead.phone,
                "email": lead.email,
                "interested_products": lead.interested_products or [],
                "converted_partner_id": lead.converted_partner_id,
            })

    return {
        "count": len(results),
        "customers": results,
    }


@register_tool(
    name="crm_get_customer_360",
    description="Lấy thông tin chi tiết toàn cảnh (360 độ) về 1 khách hàng: Hồ sơ, người liên hệ, các gói dịch vụ/sản phẩm đang dùng, hạn hợp đồng, lịch gặp gần đây và các buổi tập huấn.",
    module="digital-training",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "partner_id": {
                "type": "integer",
                "description": "ID của đối tác khách hàng hiện tại (TrainingPartner)",
            },
            "partner_name": {
                "type": "string",
                "description": "Tên khách hàng để tìm kiếm nếu không nhớ ID",
            },
        },
        "additionalProperties": False,
    },
)
def crm_get_customer_360(ctx: Dict[str, Any], partner_id: Optional[int] = None, partner_name: Optional[str] = None, **_kwargs) -> Dict[str, Any]:
    partner, lookup_error = find_partner(partner_id, partner_name) if (partner_id or partner_name) else (None, "")

    if not partner:
        return {"success": False, "error": lookup_error or "Không tìm thấy khách hàng phù hợp."}

    # 1. Gói sản phẩm / subscriptions
    subs = TrainingProductSubscription.objects.filter(partner=partner).select_related("product")
    products_info = []
    for s in subs:
        products_info.append({
            "product_name": s.product.name,
            "product_code": s.product.code,
            "quantity": s.quantity,
            "starts_at": s.starts_at.isoformat() if s.starts_at else None,
            "expires_at": s.effective_expires_at.isoformat() if s.effective_expires_at else None,
            "status": product_subscription_status(s),
            "is_expiring_soon": product_subscription_status(s) == "expiring",
        })

    # 2. Lịch gặp gần đây
    meetings = TrainingCustomerMeeting.objects.filter(partner=partner).order_by("-meeting_date", "-start_time")[:5]
    meetings_info = [
        {
            "id": m.id,
            "title": m.title,
            "date": m.meeting_date.isoformat(),
            "time": f"{m.start_time or ''} - {m.end_time or ''}",
            "staff": m.staff_name,
            "status": m.status,
            "content": m.content,
        }
        for m in meetings
    ]

    # 3. Lớp học & buổi tập huấn
    classes = partner.classes.all()
    sessions = partner.sessions.order_by("-session_date")[:5]
    sessions_info = [
        {
            "id": s.id,
            "title": s.title,
            "date": s.session_date.isoformat() if s.session_date else None,
            "status": s.status,
            "instructor": s.instructor_name,
            "attendees": s.attendees,
        }
        for s in sessions
    ]

    return {
        "success": True,
        "customer": {
            "id": partner.id,
            "name": partner.name,
            "province": partner.province or "",
            "address": partner.address,
            "contact_person": partner.contact_person,
            "contact_position": partner.contact_position,
            "phone": partner.phone,
            "email": partner.email,
            "additional_contacts": partner.additional_contacts,
            "contract": {
                "signed_date": partner.contract_signed_date.isoformat() if partner.contract_signed_date else None,
                "duration": f"{partner.contract_duration} {partner.contract_duration_unit}" if partner.contract_duration else "",
                "start": partner.contract_start,
                "end": partner.contract_end,
                "status": partner.contract_status,
                "budget": float(partner.budget) if partner.budget else 0,
            },
            "subscriptions": products_info,
            "recent_meetings": meetings_info,
            "classes_count": classes.count(),
            "recent_sessions": sessions_info,
            "notes": partner.notes,
        },
    }


@register_tool(
    name="crm_create_lead",
    description="Thêm mới một khách hàng tiềm năng (Lead) vào hệ thống (chống trùng với khách hàng đã có).",
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Tạo khách hàng tiềm năng (Lead)",
    parameters={
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Tên trường / đơn vị"},
            "representative": {"type": "string", "description": "Họ tên người liên hệ / đại diện"},
            "representative_position": {"type": "string", "description": "Chức vụ người đại diện"},
            "phone": {"type": "string", "description": "Số điện thoại liên hệ"},
            "email": {"type": "string", "description": "Email liên hệ"},
            "address": {"type": "string", "description": "Địa chỉ hoặc Tỉnh/Thành phố"},
            "interested_products": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Các sản phẩm/dịch vụ quan tâm (vd: BNDC, AI dùng chung, Lớp học số, Tập huấn)",
            },
            "stage": {
                "type": "string",
                "enum": ["discussion", "meeting", "proposal", "negotiation", "on_hold"],
                "description": "Giai đoạn bán hàng ban đầu (mặc định 'discussion')",
            },
            "notes": {"type": "string", "description": "Ghi chú thêm về nhu cầu của khách hàng"},
        },
        "required": ["name"],
        "additionalProperties": False,
    },
)
def crm_create_lead(
    ctx: Dict[str, Any],
    name: str,
    representative: str = "",
    representative_position: str = "",
    phone: str = "",
    email: str = "",
    address: str = "",
    interested_products: List[str] = None,
    stage: str = "discussion",
    notes: str = "",
    **_kwargs,
) -> Dict[str, Any]:
    clean_name = name.strip()
    # Kiểm tra trùng tên với khách hàng hiện tại
    existing_partner = TrainingPartner.objects.filter(name__iexact=clean_name).first()
    if existing_partner:
        return {
            "success": False,
            "error": f"Khách hàng '{clean_name}' đã tồn tại trong danh sách Khách hàng chính thức (ID: {existing_partner.id}). Không tạo mới để tránh trùng lặp.",
        }

    lead = TrainingLead.objects.create(
        name=clean_name,
        representative=representative,
        representative_position=representative_position,
        phone=phone,
        email=email,
        address=address,
        interested_products=interested_products or [],
        stage=stage,
        notes=notes,
    )

    return {
        "success": True,
        "message": f"Đã tạo khách hàng tiềm năng '{clean_name}' thành công.",
        "lead_id": lead.id,
        "stage": lead.stage,
    }


@register_tool(
    name="crm_update_lead_stage",
    description=(
        "Cập nhật giai đoạn phễu bán hàng (stage) hoặc bổ sung ghi chú cho khách hàng tiềm năng (Lead). "
        "KHÔNG dùng để ghi doanh thu/thu chi: dùng finance_create_entry (Báo cáo thu chi)."
    ),
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Cập nhật tiến trình Lead",
    parameters={
        "type": "object",
        "properties": {
            "lead_id": {"type": "integer", "description": "ID của khách hàng tiềm năng"},
            "stage": {
                "type": "string",
                "enum": ["discussion", "meeting", "proposal", "negotiation", "on_hold", "lost"],
                "description": "Giai đoạn mới",
            },
            "notes": {"type": "string", "description": "Nội dung ghi chú bổ sung (không dùng cho doanh thu/thu chi)"},
            "not_finance_record": {
                "type": "boolean",
                "description": "true chỉ khi người dùng nói rõ ghi chú có số tiền này KHÔNG phải khoản thu chi",
            },
        },
        "required": ["lead_id"],
        "additionalProperties": False,
    },
)
def crm_update_lead_stage(
    ctx: Dict[str, Any],
    lead_id: int,
    stage: Optional[str] = None,
    notes: Optional[str] = None,
    not_finance_record: bool = False,
    **_kwargs,
) -> Dict[str, Any]:
    from digital_training.finance_division import FINANCE_NOTE_REDIRECT, looks_like_finance_record

    if notes and not not_finance_record and looks_like_finance_record(notes):
        return {"success": False, "error": FINANCE_NOTE_REDIRECT, "use_tool": "finance_create_entry"}
    lead = TrainingLead.objects.filter(pk=lead_id).first()
    if not lead:
        return {"success": False, "error": f"Không tìm thấy Lead ID {lead_id}"}

    updates = []
    if stage:
        lead.stage = stage
        updates.append("stage")
    if notes is not None:
        lead.notes = f"{lead.notes}\n[{timezone.localdate().isoformat()}] {notes}".strip()
        updates.append("notes")

    if updates:
        lead.save(update_fields=[*updates, "updated_at"])

    return {
        "success": True,
        "message": f"Đã cập nhật Lead '{lead.name}'. Giai đoạn hiện tại: {lead.stage}.",
        "lead": {
            "id": lead.id,
            "name": lead.name,
            "stage": lead.stage,
            "notes": lead.notes,
        },
    }


@register_tool(
    name="crm_convert_lead_to_partner",
    description="Chuyển đổi khách hàng tiềm năng (Lead) thành Khách hàng chính thức (Partner) khi đã ký kết hợp đồng.",
    module="digital-training",
    min_role="MANAGER",
    audit_action="Chuyển đổi Lead thành Khách hàng chính thức",
    parameters={
        "type": "object",
        "properties": {
            "lead_id": {"type": "integer", "description": "ID của Lead cần chuyển đổi"},
            "contract_duration": {"type": "integer", "description": "Thời hạn hợp đồng (ví dụ: 1)"},
            "contract_duration_unit": {
                "type": "string",
                "enum": ["year", "month"],
                "description": "Đơn vị thời hạn ('year' hoặc 'month')",
            },
            "budget": {"type": "number", "description": "Giá trị hợp đồng (VNĐ)"},
            "ai_account_count": {"type": "integer", "description": "Số tài khoản AI được cấp (nếu có)"},
        },
        "required": ["lead_id"],
        "additionalProperties": False,
    },
)
def crm_convert_lead_to_partner(
    ctx: Dict[str, Any],
    lead_id: int,
    contract_duration: Optional[int] = 1,
    contract_duration_unit: str = "year",
    budget: Optional[float] = None,
    ai_account_count: int = 0,
    **_kwargs,
) -> Dict[str, Any]:
    lead = TrainingLead.objects.filter(pk=lead_id).first()
    if not lead:
        return {"success": False, "error": f"Không tìm thấy Lead ID {lead_id}"}
    if lead.converted_partner_id:
        return {"success": False, "error": f"Lead '{lead.name}' đã được chuyển đổi sang Partner ID {lead.converted_partner_id} trước đó."}

    today = timezone.localdate()
    partner = TrainingPartner.objects.create(
        name=lead.name.strip(),
        address=lead.address,
        contact_person=lead.representative,
        contact_position=lead.representative_position,
        phone=lead.phone,
        email=lead.email,
        partner_type=lead.lead_type or "Trường học",
        products=lead.interested_products,
        contract_status="signed",
        contract_signed_date=today,
        contract_start=today.isoformat(),
        contract_duration=contract_duration,
        contract_duration_unit=contract_duration_unit,
        budget=budget,
        ai_account_count=ai_account_count,
        notes=lead.notes,
    )

    # Tự động kích hoạt các subscriptions
    sync_partner_product_subscriptions(partner)

    # Đánh dấu lead là converted
    lead.converted_partner = partner
    lead.stage = "converted"
    lead.save(update_fields=["converted_partner", "stage", "updated_at"])

    return {
        "success": True,
        "message": f"Chuyển đổi thành công. Khách hàng chính thức: '{partner.name}' (ID: {partner.id}).",
        "partner_id": partner.id,
    }


@register_tool(
    name="crm_schedule_meeting",
    description="Lên lịch gặp gỡ, demo sản phẩm hoặc làm việc với khách hàng mới hoặc đối tác hiện tại (chống trùng lịch).",
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Lên lịch gặp khách hàng",
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Tiêu đề buổi làm việc / gặp gỡ"},
            "meeting_date": {"type": "string", "description": "Ngày gặp (định dạng YYYY-MM-DD)"},
            "start_time": {"type": "string", "description": "Giờ bắt đầu (định dạng HH:MM, ví dụ: 09:00)"},
            "end_time": {"type": "string", "description": "Giờ kết thúc (định dạng HH:MM, ví dụ: 10:30)"},
            "customer_name": {"type": "string", "description": "Tên khách hàng/đơn vị"},
            "partner_id": {"type": "integer", "description": "ID khách hàng hiện tại (nếu có)"},
            "lead_id": {"type": "integer", "description": "ID khách hàng mới (nếu có)"},
            "staff_name": {"type": "string", "description": "Nhân sự phụ trách buổi gặp"},
            "location": {"type": "string", "description": "Địa điểm (Trực tiếp tại trường hoặc Link Online)"},
            "content": {"type": "string", "description": "Nội dung chuẩn bị và trao đổi"},
        },
        "required": ["title", "meeting_date"],
        "additionalProperties": False,
    },
)
def crm_schedule_meeting(
    ctx: Dict[str, Any],
    title: str,
    meeting_date: str,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    customer_name: str = "",
    partner_id: Optional[int] = None,
    lead_id: Optional[int] = None,
    staff_name: str = "",
    location: str = "",
    content: str = "",
    **_kwargs,
) -> Dict[str, Any]:
    staff = staff_name.strip() or ctx.get("name", "")

    # Kiểm tra trùng lịch
    duplicate = TrainingCustomerMeeting.objects.filter(
        title=title.strip(),
        meeting_date=meeting_date,
        staff_name=staff,
    ).first()

    if duplicate:
        return {
            "success": True,
            "message": f"Buổi gặp '{title}' vào ngày {meeting_date} đã có trong lịch (ID: {duplicate.id}). Không tạo trùng.",
            "meeting_id": duplicate.id,
        }

    meeting = TrainingCustomerMeeting.objects.create(
        title=title.strip(),
        meeting_date=meeting_date,
        start_time=start_time or None,
        end_time=end_time or None,
        partner_id=partner_id,
        lead_id=lead_id,
        staff_name=staff,
        location=location,
        content=content,
        status="planned",
    )

    return {
        "success": True,
        "message": f"Đã lên lịch gặp '{meeting.title}' ngày {meeting.meeting_date} thành công.",
        "meeting_id": meeting.id,
        "staff": staff,
    }


@register_tool(
    name="crm_get_expiring_products",
    description="Tra cứu danh sách các khách hàng có sản phẩm/dịch vụ (BNDC, Lớp học số, AI dùng chung...) sắp hết hạn hoặc đã hết hạn để chuẩn bị gia hạn.",
    module="digital-training",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "days_ahead": {
                "type": "integer",
                "description": "Số ngày tới để rà soát (mặc định 30 ngày)",
            },
        },
        "additionalProperties": False,
    },
)
def crm_get_expiring_products(ctx: Dict[str, Any], days_ahead: int = 30, **_kwargs) -> Dict[str, Any]:
    today = timezone.localdate()
    target_date = today + timedelta(days=days_ahead)

    due = TrainingProductSubscription.objects.select_related("partner", "product").filter(
        status="active",
    ).exclude(product__code="tap-huan").annotate(
        effective_expiry=Coalesce("expires_at", "contract_expires_at"),
    ).filter(
        effective_expiry__isnull=False,
        effective_expiry__lte=target_date,
    ).order_by("effective_expiry")

    items = []
    for s in due[:50]:
        days_left = (s.effective_expiry - today).days
        items.append({
            "subscription_id": s.id,
            "partner_id": s.partner.id,
            "partner_name": s.partner.name,
            "product_name": s.product.name,
            "expires_at": s.effective_expiry.isoformat(),
            "days_left": days_left,
            "status": "Đã quá hạn" if days_left < 0 else f"Còn {days_left} ngày",
            "contact_person": s.partner.contact_person,
            "phone": s.partner.phone,
        })

    return {
        "total": len(items),
        "days_window": days_ahead,
        "items": items,
    }


@register_tool(
    name="crm_list_subscriptions",
    description="Tra cứu và lọc danh sách các dịch vụ mà khách hàng (trường học/đối tác) đã đăng ký, thời hạn sử dụng và số ngày còn lại.",
    module="digital-training",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Tìm kiếm theo tên trường, đơn vị, tỉnh thành hoặc người liên hệ",
            },
            "status_filter": {
                "type": "string",
                "enum": ["all", "active", "expiring", "expired", "paused"],
                "description": "Lọc theo trạng thái: 'all', 'active' (đang dùng), 'expiring' (sắp hết hạn trong 30 ngày), 'expired' (đã quá hạn)",
            },
            "product_code": {
                "type": "string",
                "description": "Mã sản phẩm/dịch vụ (vd: 'ai-dung-chung', 'bai-hoc-stem', 'lop-hoc-so', 'bndc')",
            },
        },
        "additionalProperties": False,
    },
)
def crm_list_subscriptions(
    ctx: Dict[str, Any],
    query: str = "",
    status_filter: str = "all",
    product_code: str = "",
    **_kwargs,
) -> Dict[str, Any]:
    today = timezone.localdate()
    qs = TrainingProductSubscription.objects.select_related("partner", "product").all()

    if query:
        qs = qs.filter(
            Q(partner__name__icontains=query)
            | Q(partner__contact_person__icontains=query)
            | Q(partner__province__icontains=query)
            | Q(partner__phone__icontains=query)
            | Q(product__name__icontains=query)
        )

    if product_code:
        qs = qs.filter(product__code=product_code)

    items = []
    for sub in qs.order_by("partner__name", "product__display_order"):
        expiry = sub.effective_expires_at
        days_left = (expiry - today).days if expiry else None
        eff = product_subscription_status(sub)

        if status_filter != "all" and eff != status_filter:
            continue

        if len(items) >= 100:
            break
        items.append({
            "subscription_id": sub.id,
            "partner_id": sub.partner.id,
            "partner_name": sub.partner.name,
            "province": sub.partner.province or "",
            "contact_person": sub.partner.contact_person,
            "phone": sub.partner.phone,
            "product_name": sub.product.name,
            "product_code": sub.product.code,
            "quantity": sub.quantity,
            "starts_at": sub.starts_at.isoformat() if sub.starts_at else None,
            "expires_at": expiry.isoformat() if expiry else None,
            "days_remaining": days_left,
            "status": eff,
            "status_label": {
                "active": "Đang sử dụng",
                "expiring": "Sắp hết hạn",
                "expired": "Đã quá hạn",
                "paused": "Tạm dừng",
                "cancelled": "Đã hủy",
            }.get(eff, eff),
            "notes": sub.notes,
        })

    return {
        "count": len(items),
        "subscriptions": items,
    }


@register_tool(
    name="crm_renew_subscription",
    description="Gia hạn gói dịch vụ/sản phẩm cho khách hàng. Có thể gia hạn theo số tháng (+3, +6, +12 tháng) hoặc chỉ định ngày hết hạn mới. Tự động đồng bộ ra Google Sheet.",
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Gia hạn dịch vụ khách hàng",
    parameters={
        "type": "object",
        "properties": {
            "subscription_id": {
                "type": "integer",
                "description": "ID gói đăng ký dịch vụ (nếu biết)",
            },
            "partner_name": {
                "type": "string",
                "description": "Tên trường / đối tác cần gia hạn (nếu không nhớ ID)",
            },
            "product_name": {
                "type": "string",
                "description": "Tên hoặc mã sản phẩm/dịch vụ cần gia hạn (vd: 'AI dùng chung', 'Lớp học số')",
            },
            "months_to_add": {
                "type": "integer",
                "description": "Số tháng gia hạn thêm (ví dụ: 12 cho 1 năm, 6 cho nửa năm)",
            },
            "new_expiry_date": {
                "type": "string",
                "description": "Ngày hết hạn mới (định dạng YYYY-MM-DD, tùy chọn thay cho months_to_add)",
            },
            "notes": {
                "type": "string",
                "description": "Ghi chú gia hạn / số hợp đồng / người duyệt",
            },
        },
        "additionalProperties": False,
    },
)
def crm_renew_subscription(
    ctx: Dict[str, Any],
    subscription_id: Optional[int] = None,
    partner_name: str = "",
    product_name: str = "",
    months_to_add: Optional[int] = None,
    new_expiry_date: Optional[str] = None,
    notes: str = "",
    **_kwargs,
) -> Dict[str, Any]:
    import calendar
    import datetime

    today = timezone.localdate()
    sub = None

    if subscription_id:
        sub = TrainingProductSubscription.objects.select_related("partner", "product").filter(pk=subscription_id).first()
    elif partner_name:
        partner, lookup_error = find_partner(None, partner_name)
        if not partner:
            return {"success": False, "error": lookup_error}
        qs = TrainingProductSubscription.objects.select_related("partner", "product").filter(partner=partner)
        if product_name:
            qs = qs.filter(Q(product__name__icontains=product_name.strip()) | Q(product__code__icontains=product_name.strip()))
        candidates = list(qs[:6])
        if len(candidates) > 1:
            names = "; ".join(f"{c.product.name} (subscription_id {c.id})" for c in candidates[:5])
            return {"success": False, "error": f"'{partner.name}' có nhiều gói khớp: {names}. Hãy nêu product_name hoặc subscription_id."}
        sub = candidates[0] if candidates else None

    if not sub:
        return {"success": False, "error": f"Không tìm thấy gói dịch vụ khớp với thông tin cung cấp (Partner: '{partner_name}', Product: '{product_name}')."}

    target_date = None
    if new_expiry_date:
        try:
            target_date = datetime.date.fromisoformat(new_expiry_date.strip())
        except ValueError:
            return {"success": False, "error": "Định dạng new_expiry_date không hợp lệ (cần YYYY-MM-DD)."}
    elif months_to_add:
        m = int(months_to_add)
        current_expiry = sub.effective_expires_at
        base_date = current_expiry if (current_expiry and current_expiry > today) else today
        month_idx = base_date.month - 1 + m
        year = base_date.year + month_idx // 12
        month = month_idx % 12 + 1
        day = min(base_date.day, calendar.monthrange(year, month)[1])
        target_date = datetime.date(year, month, day)
    else:
        return {"success": False, "error": "Vui lòng cung cấp months_to_add hoặc new_expiry_date."}

    old_expiry = sub.expires_at
    sub.expires_at = target_date
    sub.status = "active"
    sub.expiry_notice_stage = 0

    staff_name = ctx.get("name", "AI Assistant")
    entry_note = f"[{today.strftime('%d/%m/%Y')}] {staff_name} gia hạn đến {target_date.strftime('%d/%m/%Y')}"
    if notes:
        entry_note += f": {notes}"
    sub.notes = f"{sub.notes}\n{entry_note}".strip() if sub.notes else entry_note

    sub.save(update_fields=["expires_at", "status", "expiry_notice_stage", "notes", "updated_at"])

    # Tự động đồng bộ ra Google Sheet
    sheet_status = "unconfigured"
    try:
        from digital_training.subscription_sheet_sync import export_subscriptions_to_sheet
        res = export_subscriptions_to_sheet(force=True)
        sheet_status = res.get("status", "ok")
    except Exception as exc:
        sheet_status = f"error: {exc}"

    return {
        "success": True,
        "message": f"Đã gia hạn thành công dịch vụ '{sub.product.name}' cho khách hàng '{sub.partner.name}'.",
        "subscription_id": sub.id,
        "partner_name": sub.partner.name,
        "product_name": sub.product.name,
        "old_expiry_date": old_expiry.isoformat() if old_expiry else None,
        "new_expiry_date": target_date.isoformat(),
        "days_remaining": (target_date - today).days,
        "sheet_sync_status": sheet_status,
    }


@register_tool(
    name="crm_sync_subscriptions_sheet",
    description="Kích hoạt đồng bộ song song 2 chiều giữa Web FTWorkspace và Google Sheet theo dõi dịch vụ khách hàng (tự động nhận các cập nhật trên Sheet và xuất lại Web).",
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Đồng bộ Google Sheet dịch vụ khách hàng",
    parameters={
        "type": "object",
        "properties": {
            "force": {
                "type": "boolean",
                "description": "Bắt buộc đồng bộ kể cả khi không phát hiện thay đổi",
            },
        },
        "additionalProperties": False,
    },
)
def crm_sync_subscriptions_sheet(ctx: Dict[str, Any], force: bool = True, **_kwargs) -> Dict[str, Any]:
    from digital_training.subscription_sheet_sync import sync_subscriptions_safely
    try:
        res = sync_subscriptions_safely(force=force)
        return {
            "success": True,
            "message": "Đã thực hiện đồng bộ 2 chiều thành công giữa Web và Google Sheet.",
            "data": res,
        }
    except Exception as exc:
        return {
            "success": False,
            "error": f"Lỗi đồng bộ Sheet: {exc}",
        }


def _generate_secure_password(length: int = 12) -> str:
    import secrets
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*"
    return "".join(secrets.choice(chars) for _ in range(length))


def _mask_secret(value: str) -> str:
    value = str(value or "")
    if not value:
        return ""
    return f"{value[:2]}{'•' * 6}" if len(value) > 4 else "••••••"


def _log_secret_access(ctx: Dict[str, Any], action: str, count: int, scope: str) -> None:
    """Ghi nhật ký mỗi lần mật khẩu tài khoản AI được hiển thị qua MCP."""
    try:
        import uuid as _uuid

        from examination.models import LogNote

        LogNote.objects.create(
            key=f"mcp:ai-account-secret:{_uuid.uuid4().hex[:8]}",
            entity_key="mcp-digital-training",
            content=f"[AI Plugin/MCP] {action}: hiển thị mật khẩu của {count} tài khoản AI ({scope}).",
            updated_by=f"{ctx.get('name') or ctx.get('email')} (qua MCP)",
            actor_email=ctx.get("email", ""),
            system=False,
        )
    except Exception:  # Nhật ký phụ, không làm hỏng thao tác chính.
        pass


def _sync_partner_ai_count(partner: TrainingPartner) -> int:
    return partner.refresh_ai_account_count()


# =========================================================================
# SUBSCRIPTIONS: IMPORT & EXPORT TOOLS
# =========================================================================

@register_tool(
    name="crm_export_subscriptions",
    description="Xuất (export) toàn bộ dữ liệu theo dõi thời hạn sử dụng BNDC & dịch vụ số của khách hàng ra định dạng CSV (chuẩn UTF-8 BOM) hoặc JSON để làm báo cáo, kiểm toán hoặc AI điền dữ liệu.",
    module="digital-training",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "status_filter": {
                "type": "string",
                "enum": ["all", "active", "expiring", "expired", "paused"],
                "description": "Lọc theo trạng thái thời hạn ('all', 'active', 'expiring', 'expired')",
            },
            "product_code": {
                "type": "string",
                "description": "Lọc theo mã sản phẩm (vd: 'bndc', 'ai-dung-chung', 'lop-hoc-so')",
            },
            "query": {
                "type": "string",
                "description": "Tìm kiếm theo tên trường, người liên hệ, tỉnh thành",
            },
            "format": {
                "type": "string",
                "enum": ["csv", "json"],
                "description": "Định dạng xuất dữ liệu: 'csv' (chuỗi CSV UTF-8 BOM tải vào Excel) hoặc 'json' (mặc định)",
            },
        },
        "additionalProperties": False,
    },
)
def crm_export_subscriptions(
    ctx: Dict[str, Any],
    status_filter: str = "all",
    product_code: str = "",
    query: str = "",
    format: str = "json",
    **_kwargs,
) -> Dict[str, Any]:
    today = timezone.localdate()
    qs = TrainingProductSubscription.objects.select_related("partner", "product").all()

    if query:
        qs = qs.filter(
            Q(partner__name__icontains=query)
            | Q(partner__contact_person__icontains=query)
            | Q(partner__province__icontains=query)
            | Q(product__name__icontains=query)
        )
    if product_code:
        qs = qs.filter(product__code=product_code)

    items = []
    for sub in qs.order_by("partner__name", "product__display_order"):
        expiry = sub.effective_expires_at
        days_left = (expiry - today).days if expiry else None
        eff = product_subscription_status(sub)

        if status_filter != "all" and eff != status_filter:
            continue

        items.append({
            "subscription_id": sub.id,
            "partner_id": sub.partner.id,
            "partner_name": sub.partner.name,
            "province": sub.partner.province or "",
            "contact_person": sub.partner.contact_person or "",
            "phone": sub.partner.phone or "",
            "product_name": sub.product.name,
            "product_code": sub.product.code,
            "quantity": sub.quantity,
            "starts_at": sub.starts_at.isoformat() if sub.starts_at else "",
            "expires_at": expiry.isoformat() if expiry else "",
            "days_remaining": days_left,
            "status": eff,
            "notes": sub.notes or "",
        })

    if format == "csv":
        import csv
        import io
        out = io.StringIO()
        out.write("\ufeff")  # UTF-8 BOM
        writer = csv.writer(out)
        writer.writerow([
            "STT", "Mã khách hàng", "Tên trường / Khách hàng", "Tỉnh thành",
            "Người liên hệ", "Số điện thoại", "Sản phẩm / Dịch vụ", "Số lượng",
            "Ngày bắt đầu", "Ngày hết hạn", "Còn lại (ngày)", "Trạng thái", "Ghi chú",
        ])
        for idx, it in enumerate(items, 1):
            writer.writerow([
                idx, it["partner_id"], it["partner_name"], it["province"],
                it["contact_person"], it["phone"], it["product_name"], it["quantity"],
                it["starts_at"], it["expires_at"],
                it["days_remaining"] if it["days_remaining"] is not None else "Không giới hạn",
                it["status"], it["notes"],
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
        "subscriptions": items,
    }


@register_tool(
    name="crm_import_subscriptions",
    description="Nhập (import) và phân bổ hàng loạt gói dịch vụ / BNDC cho khách hàng từ danh sách mảng JSON hoặc chuỗi văn bản (dán từ Excel/CSV). Tự động tạo bản ghi và cập nhật ra Google Sheet.",
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Nhập hàng loạt dịch vụ khách hàng",
    parameters={
        "type": "object",
        "properties": {
            "subscriptions": {
                "type": "array",
                "description": "Danh sách các gói dịch vụ cần phân bổ: [{'partner_name': '...', 'product_code': '...', 'quantity': 1, 'starts_at': '...', 'expires_at': '...', 'notes': '...'}]",
                "items": {"type": "object"},
            },
            "raw_text": {
                "type": "string",
                "description": "Chuỗi văn bản nhiều dòng copy từ Excel/Notepad dạng 'Tên trường | Mã sản phẩm | Số lượng | Ngày bắt đầu | Ngày hết hạn | Ghi chú'",
            },
            "default_months": {
                "type": "integer",
                "description": "Số tháng sử dụng mặc định nếu dòng dữ liệu không có ngày hết hạn (mặc định 12 tháng)",
            },
            "sync_sheet": {
                "type": "boolean",
                "description": "Có tự động đồng bộ ra Google Sheet sau khi import hay không (mặc định True)",
            },
        },
        "additionalProperties": False,
    },
)
def crm_import_subscriptions(
    ctx: Dict[str, Any],
    subscriptions: Optional[List[Dict[str, Any]]] = None,
    raw_text: str = "",
    default_months: int = 12,
    sync_sheet: bool = True,
    **_kwargs,
) -> Dict[str, Any]:
    import calendar
    import datetime

    today = timezone.localdate()
    items_to_process = []

    if subscriptions and isinstance(subscriptions, list):
        items_to_process.extend(subscriptions)

    if raw_text and raw_text.strip():
        for line in raw_text.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            if "\t" in line:
                parts = line.split("\t")
            elif "|" in line:
                parts = line.split("|")
            elif "," in line:
                parts = line.split(",")
            else:
                parts = line.split()

            p_name = parts[0].strip() if len(parts) > 0 else ""
            p_code = parts[1].strip() if len(parts) > 1 else ""
            qty = 1
            if len(parts) > 2:
                try:
                    qty = int(parts[2].strip())
                except ValueError:
                    qty = 1
            s_at = parts[3].strip() if len(parts) > 3 else ""
            e_at = parts[4].strip() if len(parts) > 4 else ""
            notes = parts[5].strip() if len(parts) > 5 else ""

            if p_name and p_code:
                items_to_process.append({
                    "partner_name": p_name,
                    "product_code": p_code,
                    "quantity": qty,
                    "starts_at": s_at,
                    "expires_at": e_at,
                    "notes": notes,
                })

    if not items_to_process:
        return {"success": False, "error": "Không có dữ liệu gói dịch vụ để nhập (vui lòng cung cấp 'subscriptions' hoặc 'raw_text')."}

    created_count = 0
    updated_count = 0
    errors = []
    processed_items = []

    for idx, item in enumerate(items_to_process, 1):
        p_name = str(item.get("partner_name", "")).strip()
        p_id = item.get("partner_id")
        p_code = str(item.get("product_code", "")).strip()

        partner, lookup_error = find_partner(p_id, p_name) if (p_id or p_name) else (None, "")

        if not partner:
            errors.append(f"Dòng {idx}: {lookup_error}" if lookup_error else f"Dòng {idx}: Không tìm thấy trường/đối tác '{p_name or p_id}'")
            continue

        product = TrainingProduct.objects.filter(
            Q(code__iexact=p_code) | Q(name__icontains=p_code)
        ).first()
        if not product:
            errors.append(f"Dòng {idx}: Không tìm thấy sản phẩm/dịch vụ '{p_code}'")
            continue

        starts_date = today
        if item.get("starts_at"):
            try:
                starts_date = datetime.date.fromisoformat(str(item["starts_at"]).strip())
            except ValueError:
                starts_date = today

        expires_date = None
        if item.get("expires_at"):
            try:
                expires_date = datetime.date.fromisoformat(str(item["expires_at"]).strip())
            except ValueError:
                pass

        if not expires_date and default_months > 0:
            m = int(default_months)
            month_idx = starts_date.month - 1 + m
            year = starts_date.year + month_idx // 12
            month = month_idx % 12 + 1
            day = min(starts_date.day, calendar.monthrange(year, month)[1])
            expires_date = datetime.date(year, month, day)

        qty = int(item.get("quantity") or 1)
        notes = str(item.get("notes") or "").strip()

        sub, created = TrainingProductSubscription.objects.update_or_create(
            partner=partner,
            product=product,
            defaults={
                "quantity": qty,
                "starts_at": starts_date,
                "expires_at": expires_date,
                "status": "active",
                "notes": notes,
            },
        )
        if created:
            created_count += 1
        else:
            updated_count += 1

        processed_items.append({
            "subscription_id": sub.id,
            "partner_name": partner.name,
            "product_name": product.name,
            "quantity": qty,
            "starts_at": starts_date.isoformat(),
            "expires_at": expires_date.isoformat() if expires_date else None,
            "action": "created" if created else "updated",
        })

    sheet_status = "skipped"
    if sync_sheet:
        try:
            from digital_training.subscription_sheet_sync import export_subscriptions_to_sheet
            res = export_subscriptions_to_sheet(force=True)
            sheet_status = res.get("status", "ok")
        except Exception as exc:
            sheet_status = f"error: {exc}"

    return {
        "success": True,
        "message": f"Đã nhập thành công {created_count + updated_count} gói dịch vụ ({created_count} mới, {updated_count} cập nhật).",
        "created_count": created_count,
        "updated_count": updated_count,
        "errors": errors,
        "sheet_sync_status": sheet_status,
        "processed_subscriptions": processed_items,
    }


# =========================================================================
# AI ACCOUNTS (TK AI DÙNG CHUNG): CRUD, IMPORT & EXPORT TOOLS
# =========================================================================

@register_tool(
    name="crm_list_ai_accounts",
    description="Tra cứu danh sách tài khoản & mật khẩu AI Dùng chung (ChatGPT Plus/Team, Claude Pro, Gemini Advanced, Canva Pro, Midjourney,...) đã cấp cho khách hàng. Có thể lọc theo trường, nền tảng, trạng thái hoặc tìm kiếm người nhận.",
    module="digital-training",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "partner_id": {"type": "integer", "description": "Lọc theo ID trường học"},
            "partner_name": {"type": "string", "description": "Lọc theo tên trường học / đối tác"},
            "platform": {
                "type": "string",
                "enum": ["all", "chatgpt_plus", "chatgpt_team", "claude_pro", "gemini_advanced", "canva_pro", "midjourney", "copilot", "shared_ai", "other"],
                "description": "Lọc theo nền tảng AI",
            },
            "status": {
                "type": "string",
                "enum": ["all", "active", "expired", "locked", "revoked"],
                "description": "Lọc theo trạng thái tài khoản",
            },
            "query": {"type": "string", "description": "Tìm kiếm email/username, người nhận, tổ bộ môn hoặc ghi chú"},
            "show_passwords": {
                "type": "boolean",
                "description": "Mặc định false: mật khẩu bị che. Chỉ đặt true khi người dùng yêu cầu rõ xem mật khẩu; mỗi lần xem được ghi nhật ký.",
            },
        },
        "additionalProperties": False,
    },
)
def crm_list_ai_accounts(
    ctx: Dict[str, Any],
    partner_id: Optional[int] = None,
    partner_name: str = "",
    platform: str = "all",
    status: str = "all",
    query: str = "",
    show_passwords: bool = False,
    **_kwargs,
) -> Dict[str, Any]:
    today = timezone.localdate()
    qs = TrainingPartnerAiAccount.objects.select_related("partner", "subscription").all()

    if partner_id:
        qs = qs.filter(partner_id=partner_id)
    elif partner_name:
        qs = qs.filter(partner__name__icontains=partner_name.strip())

    if platform and platform != "all":
        qs = qs.filter(platform=platform)

    if status and status != "all":
        qs = qs.filter(status=status)

    if query:
        qs = qs.filter(
            Q(account_username__icontains=query)
            | Q(assigned_to__icontains=query)
            | Q(notes__icontains=query)
            | Q(partner__name__icontains=query)
        )

    accounts = []
    for acc in qs.order_by("partner__name", "-created_at")[:200]:
        days_left = (acc.expires_at - today).days if acc.expires_at else None
        accounts.append({
            "id": acc.id,
            "partner_id": acc.partner.id,
            "partner_name": acc.partner.name,
            "platform": acc.platform,
            "platform_display": acc.get_platform_display(),
            "account_username": acc.account_username,
            "account_password": acc.account_password if show_passwords else _mask_secret(acc.account_password),
            "assigned_to": acc.assigned_to,
            "starts_at": acc.starts_at.isoformat() if acc.starts_at else None,
            "expires_at": acc.expires_at.isoformat() if acc.expires_at else None,
            "days_remaining": days_left,
            "status": acc.status,
            "status_display": acc.get_status_display(),
            "notes": acc.notes,
        })

    if show_passwords and accounts:
        _log_secret_access(ctx, "Tra cứu tài khoản AI", len(accounts), partner_name or str(partner_id or "tất cả"))

    return {
        "count": len(accounts),
        "passwords_hidden": not show_passwords,
        "accounts": accounts,
    }


@register_tool(
    name="crm_create_ai_account",
    description="Cấp mới một tài khoản AI (ChatGPT, Claude, Gemini, Canva, Midjourney...) cho khách hàng/trường học. Hỗ trợ tự sinh mật khẩu ngẫu nhiên an toàn nếu để trống.",
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Cấp tài khoản AI mới",
    parameters={
        "type": "object",
        "properties": {
            "partner_id": {"type": "integer", "description": "ID trường học / khách hàng (nếu biết)"},
            "partner_name": {"type": "string", "description": "Tên trường học / khách hàng"},
            "platform": {
                "type": "string",
                "description": "Nền tảng AI: 'chatgpt_plus', 'chatgpt_team', 'claude_pro', 'gemini_advanced', 'canva_pro', 'midjourney', 'copilot', 'shared_ai', 'other'",
            },
            "account_username": {"type": "string", "description": "Tên tài khoản (Email đăng nhập hoặc username)"},
            "account_password": {"type": "string", "description": "Mật khẩu (để trống hệ thống sẽ tự sinh mật khẩu mạnh)"},
            "assigned_to": {"type": "string", "description": "Người hoặc tổ bộ môn sử dụng (vd: 'Tổ Toán - Tin', 'Thầy Hoàng')"},
            "starts_at": {"type": "string", "description": "Ngày cấp (YYYY-MM-DD, mặc định hôm nay)"},
            "expires_at": {"type": "string", "description": "Ngày hết hạn (YYYY-MM-DD, mặc định 1 năm từ ngày cấp)"},
            "status": {
                "type": "string",
                "enum": ["active", "expired", "locked", "revoked"],
                "description": "Trạng thái tài khoản (mặc định 'active')",
            },
            "notes": {"type": "string", "description": "Ghi chú mục đích sử dụng"},
        },
        "required": ["account_username"],
        "additionalProperties": False,
    },
)
def crm_create_ai_account(
    ctx: Dict[str, Any],
    account_username: str,
    partner_id: Optional[int] = None,
    partner_name: str = "",
    platform: str = "chatgpt_plus",
    account_password: str = "",
    assigned_to: str = "",
    starts_at: Optional[str] = None,
    expires_at: Optional[str] = None,
    status: str = "active",
    notes: str = "",
    **_kwargs,
) -> Dict[str, Any]:
    import datetime

    today = timezone.localdate()
    partner, lookup_error = find_partner(partner_id, partner_name) if (partner_id or partner_name) else (None, "")

    if not partner:
        return {"success": False, "error": lookup_error or f"Không tìm thấy trường học khớp với thông tin ('{partner_name or partner_id}')."}

    password = account_password.strip() if account_password else _generate_secure_password(12)

    s_date = today
    if starts_at:
        try:
            s_date = datetime.date.fromisoformat(starts_at.strip())
        except ValueError:
            s_date = today

    e_date = None
    if expires_at:
        try:
            e_date = datetime.date.fromisoformat(expires_at.strip())
        except ValueError:
            pass
    if not e_date:
        e_date = s_date.replace(year=s_date.year + 1)

    sub = TrainingProductSubscription.objects.filter(partner=partner, product__code="ai-dung-chung").first()

    acc = TrainingPartnerAiAccount.objects.create(
        partner=partner,
        subscription=sub,
        platform=platform or "chatgpt_plus",
        account_username=account_username.strip(),
        account_password=password,
        assigned_to=assigned_to.strip(),
        starts_at=s_date,
        expires_at=e_date,
        status=status,
        notes=notes.strip(),
    )

    new_total = _sync_partner_ai_count(partner)

    return {
        "success": True,
        "message": f"Đã cấp thành công tài khoản AI cho trường '{partner.name}'.",
        "account": {
            "id": acc.id,
            "partner_name": partner.name,
            "platform": acc.platform,
            "platform_display": acc.get_platform_display(),
            "account_username": acc.account_username,
            "account_password": acc.account_password,
            "assigned_to": acc.assigned_to,
            "starts_at": acc.starts_at.isoformat() if acc.starts_at else None,
            "expires_at": acc.expires_at.isoformat() if acc.expires_at else None,
            "status": acc.status,
            "notes": acc.notes,
        },
        "partner_ai_account_count": new_total,
    }


@register_tool(
    name="crm_update_ai_account",
    description="Cập nhật thông tin tài khoản AI đã cấp (đổi mật khẩu, đổi người tiếp nhận, gia hạn ngày hết hạn, đổi trạng thái hoạt động/tạm khóa/thu hồi).",
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Cập nhật tài khoản AI",
    parameters={
        "type": "object",
        "properties": {
            "account_id": {"type": "integer", "description": "ID tài khoản AI"},
            "partner_name": {"type": "string", "description": "Tên trường (dùng kết hợp account_username nếu không có account_id)"},
            "account_username": {"type": "string", "description": "Email/Username của tài khoản"},
            "new_password": {"type": "string", "description": "Mật khẩu mới (nếu cần đổi)"},
            "platform": {"type": "string", "description": "Nền tảng AI mới"},
            "assigned_to": {"type": "string", "description": "Người/bộ môn tiếp nhận mới"},
            "expires_at": {"type": "string", "description": "Ngày hết hạn mới (YYYY-MM-DD)"},
            "status": {
                "type": "string",
                "enum": ["active", "expired", "locked", "revoked"],
                "description": "Trạng thái mới",
            },
            "notes": {"type": "string", "description": "Ghi chú bổ sung"},
        },
        "additionalProperties": False,
    },
)
def crm_update_ai_account(
    ctx: Dict[str, Any],
    account_id: Optional[int] = None,
    partner_name: str = "",
    account_username: str = "",
    new_password: Optional[str] = None,
    platform: Optional[str] = None,
    assigned_to: Optional[str] = None,
    expires_at: Optional[str] = None,
    status: Optional[str] = None,
    notes: Optional[str] = None,
    **_kwargs,
) -> Dict[str, Any]:
    import datetime

    acc = None
    if account_id:
        acc = TrainingPartnerAiAccount.objects.select_related("partner").filter(pk=account_id).first()
    elif partner_name and account_username:
        acc = TrainingPartnerAiAccount.objects.select_related("partner").filter(
            partner__name__icontains=partner_name.strip(),
            account_username__icontains=account_username.strip(),
        ).first()

    if not acc:
        return {"success": False, "error": f"Không tìm thấy tài khoản AI với thông tin (ID: {account_id}, Trường: '{partner_name}', Tài khoản: '{account_username}')."}

    update_fields = []
    if new_password is not None and new_password.strip():
        acc.account_password = new_password.strip()
        update_fields.append("account_password")
    if platform is not None and platform.strip():
        acc.platform = platform.strip()
        update_fields.append("platform")
    if assigned_to is not None:
        acc.assigned_to = assigned_to.strip()
        update_fields.append("assigned_to")
    if expires_at is not None:
        try:
            acc.expires_at = datetime.date.fromisoformat(expires_at.strip())
            update_fields.append("expires_at")
        except ValueError:
            return {"success": False, "error": "Định dạng expires_at không hợp lệ (YYYY-MM-DD)."}
    if status is not None and status in ["active", "expired", "locked", "revoked"]:
        acc.status = status
        update_fields.append("status")
    if notes is not None:
        acc.notes = notes.strip()
        update_fields.append("notes")

    if update_fields:
        acc.save(update_fields=update_fields)
        _sync_partner_ai_count(acc.partner)

    return {
        "success": True,
        "message": f"Đã cập nhật thành công tài khoản AI '{acc.account_username}'.",
        "account": {
            "id": acc.id,
            "partner_name": acc.partner.name,
            "platform": acc.platform,
            "platform_display": acc.get_platform_display(),
            "account_username": acc.account_username,
            "account_password": acc.account_password,
            "assigned_to": acc.assigned_to,
            "expires_at": acc.expires_at.isoformat() if acc.expires_at else None,
            "status": acc.status,
            "notes": acc.notes,
        },
    }


@register_tool(
    name="crm_delete_ai_account",
    description="Xóa hoặc thu hồi tài khoản AI của trường học. Tự động đồng bộ lại số lượng tài khoản AI đang hoạt động của trường.",
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Xóa tài khoản AI",
    parameters={
        "type": "object",
        "properties": {
            "account_id": {"type": "integer", "description": "ID tài khoản AI cần xóa"},
            "partner_name": {"type": "string", "description": "Tên trường (nếu không nhớ ID)"},
            "account_username": {"type": "string", "description": "Email/Username tài khoản cần xóa"},
            "permanent": {
                "type": "boolean",
                "description": "True: Xóa vĩnh viễn khỏi CSDL; False: Chuyển trạng thái sang 'revoked' (đã thu hồi)",
            },
        },
        "additionalProperties": False,
    },
)
def crm_delete_ai_account(
    ctx: Dict[str, Any],
    account_id: Optional[int] = None,
    partner_name: str = "",
    account_username: str = "",
    permanent: bool = True,
    **_kwargs,
) -> Dict[str, Any]:
    acc = None
    if account_id:
        acc = TrainingPartnerAiAccount.objects.select_related("partner").filter(pk=account_id).first()
    elif partner_name and account_username:
        acc = TrainingPartnerAiAccount.objects.select_related("partner").filter(
            partner__name__icontains=partner_name.strip(),
            account_username__icontains=account_username.strip(),
        ).first()

    if not acc:
        return {"success": False, "error": f"Không tìm thấy tài khoản AI với thông tin (ID: {account_id}, Trường: '{partner_name}', Tài khoản: '{account_username}')."}

    partner = acc.partner
    username = acc.account_username

    if permanent:
        acc.delete()
        action_text = "đã xóa vĩnh viễn"
    else:
        acc.status = "revoked"
        acc.save(update_fields=["status"])
        action_text = "đã chuyển sang trạng thái Đã thu hồi"

    new_total = _sync_partner_ai_count(partner)

    return {
        "success": True,
        "message": f"Tài khoản '{username}' của trường '{partner.name}' {action_text}.",
        "partner_ai_account_count": new_total,
    }


@register_tool(
    name="crm_import_ai_accounts",
    description=(
        "Nhập hàng loạt tài khoản AI cho một khách hàng từ JSON hoặc văn bản dán vào. Tự sinh mật khẩu nếu thiếu. "
        "Nếu dữ liệu nằm trên Google Sheet hoặc có mật khẩu, dùng crm_import_ai_accounts_from_sheet: "
        "máy chủ tự đọc Sheet, mật khẩu không đi qua cuộc trò chuyện (ChatGPT chặn lệnh gọi có mật khẩu)."
    ),
    module="digital-training",
    min_role="EMPLOYEE",
    audit_action="Nhập hàng loạt tài khoản AI",
    parameters={
        "type": "object",
        "properties": {
            "partner_id": {"type": "integer", "description": "ID trường học nhận tài khoản"},
            "partner_name": {"type": "string", "description": "Tên trường học nhận tài khoản"},
            "accounts": {
                "type": "array",
                "description": "Danh sách các tài khoản: [{'account_username': '...', 'account_password': '...', 'assigned_to': '...', 'platform': '...'}]",
                "items": {"type": "object"},
            },
            "raw_text": {
                "type": "string",
                "description": "Chuỗi văn bản nhiều dòng dạng 'email | mật khẩu | người nhận' hoặc 'email,mật khẩu,người nhận' (mỗi dòng 1 tài khoản)",
            },
            "default_platform": {
                "type": "string",
                "description": "Nền tảng AI mặc định nếu không ghi (mặc định 'chatgpt_plus')",
            },
            "starts_at": {"type": "string", "description": "Ngày cấp chung (YYYY-MM-DD)"},
            "expires_at": {"type": "string", "description": "Ngày hết hạn chung (YYYY-MM-DD)"},
        },
        "additionalProperties": False,
    },
)
def crm_import_ai_accounts(
    ctx: Dict[str, Any],
    partner_id: Optional[int] = None,
    partner_name: str = "",
    accounts: Optional[List[Dict[str, Any]]] = None,
    raw_text: str = "",
    default_platform: str = "chatgpt_plus",
    starts_at: Optional[str] = None,
    expires_at: Optional[str] = None,
    **_kwargs,
) -> Dict[str, Any]:
    import datetime

    today = timezone.localdate()
    partner, lookup_error = find_partner(partner_id, partner_name) if (partner_id or partner_name) else (None, "")

    if not partner:
        return {"success": False, "error": lookup_error or f"Không tìm thấy trường học nhận tài khoản ('{partner_name or partner_id}')."}

    s_date = today
    if starts_at:
        try:
            s_date = datetime.date.fromisoformat(starts_at.strip())
        except ValueError:
            s_date = today

    e_date = None
    if expires_at:
        try:
            e_date = datetime.date.fromisoformat(expires_at.strip())
        except ValueError:
            pass
    if not e_date:
        e_date = s_date.replace(year=s_date.year + 1)

    items_to_create = []

    if accounts and isinstance(accounts, list):
        for acc_data in accounts:
            u = str(acc_data.get("account_username", "")).strip()
            p = str(acc_data.get("account_password", "")).strip()
            a = str(acc_data.get("assigned_to", "")).strip()
            plat = str(acc_data.get("platform", "")).strip() or default_platform
            if u:
                items_to_create.append({
                    "username": u,
                    "password": p or _generate_secure_password(12),
                    "assigned_to": a,
                    "platform": plat,
                })

    if raw_text and raw_text.strip():
        for line in raw_text.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            if "\t" in line:
                parts = line.split("\t")
            elif "|" in line:
                parts = line.split("|")
            elif "," in line:
                parts = line.split(",")
            elif ":" in line:
                parts = line.split(":")
            else:
                parts = line.split()

            u = parts[0].strip() if len(parts) > 0 else ""
            p = parts[1].strip() if len(parts) > 1 else ""
            a = " ".join(parts[2:]).strip() if len(parts) > 2 else ""

            if u:
                items_to_create.append({
                    "username": u,
                    "password": p or _generate_secure_password(12),
                    "assigned_to": a,
                    "platform": default_platform,
                })

    if not items_to_create:
        return {"success": False, "error": "Không có tài khoản nào được cung cấp qua 'accounts' hoặc 'raw_text'."}

    sub = TrainingProductSubscription.objects.filter(partner=partner, product__code="ai-dung-chung").first()

    created_accounts = []
    for it in items_to_create:
        acc, _ = TrainingPartnerAiAccount.objects.update_or_create(
            partner=partner,
            account_username=it["username"],
            defaults={
                "subscription": sub,
                "platform": it["platform"],
                "account_password": it["password"],
                "assigned_to": it["assigned_to"],
                "starts_at": s_date,
                "expires_at": e_date,
                "status": "active",
            },
        )
        # Không trả mật khẩu về cuộc trò chuyện; xem trên web hoặc crm_list_ai_accounts khi cần.
        created_accounts.append({
            "id": acc.id,
            "account_username": acc.account_username,
            "account_password": _mask_secret(acc.account_password),
            "assigned_to": acc.assigned_to,
            "platform": acc.platform,
        })

    new_total = _sync_partner_ai_count(partner)

    return {
        "success": True,
        "message": f"Đã nhập thành công {len(created_accounts)} tài khoản AI cho trường '{partner.name}'.",
        "partner_name": partner.name,
        "count": len(created_accounts),
        "partner_ai_account_count": new_total,
        "accounts": created_accounts,
    }


@register_tool(
    name="crm_export_ai_accounts",
    description="Xuất (export) toàn bộ danh sách tài khoản, mật khẩu, người sử dụng và thời hạn AI của một trường học hoặc tất cả khách hàng ra định dạng CSV (chuẩn UTF-8 BOM) hoặc JSON để gửi cho đối tác hoặc lưu trữ.",
    module="digital-training",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "partner_id": {"type": "integer", "description": "ID trường học (để trống nếu xuất tất cả)"},
            "partner_name": {"type": "string", "description": "Tên trường học (để trống nếu xuất tất cả)"},
            "platform": {"type": "string", "description": "Lọc theo nền tảng AI"},
            "status": {"type": "string", "description": "Lọc theo trạng thái ('active', 'expired', 'locked', 'revoked', 'all')"},
            "format": {
                "type": "string",
                "enum": ["csv", "json"],
                "description": "Định dạng xuất dữ liệu: 'csv' (chuỗi CSV có UTF-8 BOM) hoặc 'json' (mặc định)",
            },
        },
        "additionalProperties": False,
    },
)
def crm_export_ai_accounts(
    ctx: Dict[str, Any],
    partner_id: Optional[int] = None,
    partner_name: str = "",
    platform: str = "all",
    status: str = "all",
    format: str = "csv",
    **_kwargs,
) -> Dict[str, Any]:
    today = timezone.localdate()
    qs = TrainingPartnerAiAccount.objects.select_related("partner").all()

    if partner_id:
        qs = qs.filter(partner_id=partner_id)
    elif partner_name:
        qs = qs.filter(partner__name__icontains=partner_name.strip())

    if platform and platform != "all":
        qs = qs.filter(platform=platform)

    if status and status != "all":
        qs = qs.filter(status=status)

    items = []
    for acc in qs.order_by("partner__name", "-created_at"):
        days_left = (acc.expires_at - today).days if acc.expires_at else None
        items.append({
            "id": acc.id,
            "partner_id": acc.partner.id,
            "partner_name": acc.partner.name,
            "platform": acc.platform,
            "platform_display": acc.get_platform_display(),
            "account_username": acc.account_username,
            "account_password": acc.account_password,
            "assigned_to": acc.assigned_to,
            "starts_at": acc.starts_at.isoformat() if acc.starts_at else "",
            "expires_at": acc.expires_at.isoformat() if acc.expires_at else "",
            "days_remaining": days_left,
            "status": acc.status,
            "status_display": acc.get_status_display(),
            "notes": acc.notes or "",
        })

    if items:
        _log_secret_access(ctx, "Xuất danh sách tài khoản AI", len(items), partner_name or str(partner_id or "tất cả"))

    if format == "csv":
        import csv
        import io
        out = io.StringIO()
        out.write("\ufeff")  # UTF-8 BOM
        writer = csv.writer(out)
        writer.writerow([
            "STT", "Trường học / Khách hàng", "Nền tảng AI",
            "Tài khoản (Email / ID)", "Mật khẩu", "Người / Bộ môn tiếp nhận",
            "Ngày cấp", "Ngày hết hạn", "Còn lại (ngày)", "Trạng thái", "Ghi chú",
        ])
        for idx, it in enumerate(items, 1):
            writer.writerow([
                idx, it["partner_name"], it["platform_display"],
                it["account_username"], it["account_password"], it["assigned_to"],
                it["starts_at"], it["expires_at"],
                it["days_remaining"] if it["days_remaining"] is not None else "Không giới hạn",
                it["status_display"], it["notes"],
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
        "accounts": items,
    }
