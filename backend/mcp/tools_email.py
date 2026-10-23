from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional

from django.db.models import Q
from django.utils import timezone

from email_builder.models import EmailTemplate
from .registry import register_tool


@register_tool(
    name="email_list_templates",
    description="Tra cứu danh sách các mẫu thiết kế Email (Email Builder) cá nhân và mẫu xuất bản dùng chung trong Workspace.",
    module="communication-tools",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Từ khóa tìm kiếm theo tên mẫu email hoặc tiêu đề subject"},
            "scope": {
                "type": "string",
                "enum": ["all", "mine", "published"],
                "description": "Phạm vi: 'all' (tất cả), 'mine' (mẫu của tôi), 'published' (mẫu xuất bản dùng chung)",
            },
        },
        "additionalProperties": False,
    },
)
def email_list_templates(ctx: Dict[str, Any], query: str = "", scope: str = "all", **_kwargs) -> Dict[str, Any]:
    user_email = ctx.get("email", "").strip().lower()
    qs = EmailTemplate.objects.all().order_by("-updated_at")

    if scope == "mine":
        qs = qs.filter(created_by__iexact=user_email)
    elif scope == "published":
        qs = qs.filter(is_published=True)
    else:
        # User sees their own templates + published templates (or all if admin)
        if ctx.get("role") not in {"ADMIN", "MANAGER"}:
            qs = qs.filter(Q(created_by__iexact=user_email) | Q(is_published=True))

    if query:
        q_clean = query.strip()
        qs = qs.filter(Q(name__icontains=q_clean) | Q(subject__icontains=q_clean))

    items = []
    for t in qs[:50]:
        items.append({
            "id": t.id,
            "name": t.name,
            "subject": t.subject,
            "created_by": t.created_by,
            "is_published": t.is_published,
            "block_count": len(t.blocks) if isinstance(t.blocks, list) else 0,
            "updated_at": t.updated_at.strftime("%d/%m/%Y %H:%M") if t.updated_at else "",
        })

    return {
        "success": True,
        "count": len(items),
        "templates": items,
    }


@register_tool(
    name="email_get_template",
    description="Xem chi tiết nội dung thiết kế, khối blocks và cấu hình của một mẫu Email theo mã template_id.",
    module="communication-tools",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "template_id": {"type": "string", "description": "Mã ID của mẫu thiết kế Email"},
        },
        "required": ["template_id"],
        "additionalProperties": False,
    },
)
def email_get_template(ctx: Dict[str, Any], template_id: str, **_kwargs) -> Dict[str, Any]:
    t = EmailTemplate.objects.filter(id=template_id.strip()).first()
    if not t:
        return {"success": False, "error": f"Không tìm thấy mẫu email với mã '{template_id}'."}

    user_email = ctx.get("email", "").strip().lower()
    if not t.is_published and t.created_by.lower() != user_email and ctx.get("role") not in {"ADMIN", "MANAGER"}:
        return {"success": False, "error": "Bạn không có quyền xem bản nháp email của tài khoản khác."}

    return {
        "success": True,
        "id": t.id,
        "name": t.name,
        "subject": t.subject,
        "settings": t.settings,
        "blocks": t.blocks,
        "created_by": t.created_by,
        "is_published": t.is_published,
        "created_at": t.created_at.strftime("%d/%m/%Y %H:%M") if t.created_at else "",
        "updated_at": t.updated_at.strftime("%d/%m/%Y %H:%M") if t.updated_at else "",
    }


@register_tool(
    name="email_create_template",
    description="Tạo một mẫu thiết kế Email mới (Email Template) trong bộ công cụ Email Builder của FermatTech.",
    module="communication-tools",
    min_role="EMPLOYEE",
    audit_action="Tạo mẫu email mới",
    parameters={
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Tên mẫu email (ví dụ: 'Thư mời tham dự kỳ thi FIMO 2026')"},
            "subject": {"type": "string", "description": "Tiêu đề thư gửi đi (email subject)"},
            "blocks": {
                "type": "array",
                "description": "Danh sách các khối nội dung (blocks: heading, text, button, image...)",
                "items": {"type": "object"},
            },
            "settings": {
                "type": "object",
                "description": "Cấu hình giao diện email (màu nền, font chữ, độ rộng container...)",
            },
            "is_published": {
                "type": "boolean",
                "description": "Xuất bản mẫu dùng chung cho toàn bộ nhân sự (mặc định: false)",
            },
        },
        "required": ["name"],
        "additionalProperties": False,
    },
)
def email_create_template(
    ctx: Dict[str, Any],
    name: str,
    subject: str = "",
    blocks: Optional[List[Dict[str, Any]]] = None,
    settings: Optional[Dict[str, Any]] = None,
    is_published: bool = False,
    **_kwargs,
) -> Dict[str, Any]:
    user_email = ctx.get("email", "").strip().lower()
    t_id = f"template-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"

    t = EmailTemplate.objects.create(
        id=t_id,
        name=str(name).strip(),
        subject=str(subject or "").strip(),
        blocks=blocks or [],
        settings=settings or {},
        last_updated=int(time.time() * 1000),
        created_by=user_email,
        updated_by=user_email,
        is_published=bool(is_published and ctx.get("role") in {"ADMIN", "MANAGER"}),
        published_at=timezone.now() if is_published else None,
    )

    return {
        "success": True,
        "message": f"Đã tạo mẫu email thành công: '{t.name}'",
        "id": t.id,
        "name": t.name,
        "subject": t.subject,
        "is_published": t.is_published,
    }


@register_tool(
    name="email_update_template",
    description="Cập nhật tên, tiêu đề subject hoặc cấu trúc các khối nội dung của mẫu thiết kế Email.",
    module="communication-tools",
    min_role="EMPLOYEE",
    audit_action="Cập nhật mẫu email",
    parameters={
        "type": "object",
        "properties": {
            "template_id": {"type": "string", "description": "Mã ID mẫu email cần sửa"},
            "name": {"type": "string", "description": "Tên mẫu email mới"},
            "subject": {"type": "string", "description": "Tiêu đề subject mới"},
            "blocks": {
                "type": "array",
                "description": "Cập nhật danh sách các khối nội dung",
                "items": {"type": "object"},
            },
            "settings": {"type": "object", "description": "Cập nhật cài đặt giao diện"},
        },
        "required": ["template_id"],
        "additionalProperties": False,
    },
)
def email_update_template(
    ctx: Dict[str, Any],
    template_id: str,
    name: Optional[str] = None,
    subject: Optional[str] = None,
    blocks: Optional[List[Dict[str, Any]]] = None,
    settings: Optional[Dict[str, Any]] = None,
    **_kwargs,
) -> Dict[str, Any]:
    t = EmailTemplate.objects.filter(id=template_id.strip()).first()
    if not t:
        return {"success": False, "error": f"Không tìm thấy mẫu email '{template_id}'."}

    user_email = ctx.get("email", "").strip().lower()
    if t.created_by.lower() != user_email and ctx.get("role") not in {"ADMIN", "MANAGER"}:
        return {"success": False, "error": "Chỉ người tạo hoặc Quản lý mới có quyền chỉnh sửa mẫu email này."}

    updated_fields = ["updated_by", "last_updated", "updated_at"]
    t.updated_by = user_email
    t.last_updated = int(time.time() * 1000)

    if name is not None:
        t.name = str(name).strip()
        updated_fields.append("name")
    if subject is not None:
        t.subject = str(subject).strip()
        updated_fields.append("subject")
    if blocks is not None:
        t.blocks = blocks
        updated_fields.append("blocks")
    if settings is not None:
        t.settings = settings
        updated_fields.append("settings")

    t.save(update_fields=updated_fields)
    return {
        "success": True,
        "message": f"Đã cập nhật mẫu email '{t.name}' thành công.",
        "id": t.id,
        "name": t.name,
        "subject": t.subject,
    }


@register_tool(
    name="email_delete_template",
    description="Xóa vĩnh viễn một mẫu thiết kế Email khỏi hệ thống.",
    module="communication-tools",
    min_role="EMPLOYEE",
    audit_action="Xóa mẫu email",
    parameters={
        "type": "object",
        "properties": {
            "template_id": {"type": "string", "description": "Mã ID mẫu email cần xóa"},
        },
        "required": ["template_id"],
        "additionalProperties": False,
    },
)
def email_delete_template(ctx: Dict[str, Any], template_id: str, **_kwargs) -> Dict[str, Any]:
    t = EmailTemplate.objects.filter(id=template_id.strip()).first()
    if not t:
        return {"success": False, "error": f"Không tìm thấy mẫu email '{template_id}'."}

    user_email = ctx.get("email", "").strip().lower()
    if t.created_by.lower() != user_email and ctx.get("role") not in {"ADMIN", "MANAGER"}:
        return {"success": False, "error": "Chỉ người tạo hoặc Quản lý mới có quyền xóa mẫu email này."}

    deleted_name = t.name
    t.delete()
    return {
        "success": True,
        "message": f"Đã xóa thành công mẫu email: '{deleted_name}'.",
        "template_id": template_id,
    }


# ==============================================================================
# TẠO CHỮ KÝ EMAIL (SIGNATURE BUILDER)
# ==============================================================================

@register_tool(
    name="signature_generate_html",
    description=(
        "Sinh mã HTML chuẩn nhận diện thương hiệu FermatTech cho chữ ký Email của nhân sự "
        "(gồm logo, họ tên, chức danh, số điện thoại, email, địa chỉ công ty và mạng xã hội) "
        "để dán trực tiếp vào chữ ký Gmail, Outlook hoặc ứng dụng gửi mail."
    ),
    module="communication-tools",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "full_name": {"type": "string", "description": "Họ và tên nhân sự (mặc định: tên tài khoản đăng nhập)"},
            "job_title": {"type": "string", "description": "Chức danh / Chức vụ chuyên môn"},
            "department": {"type": "string", "description": "Phòng ban công tác"},
            "phone": {"type": "string", "description": "Số điện thoại liên hệ"},
            "email": {"type": "string", "description": "Địa chỉ email (mặc định: email tài khoản)"},
            "website": {"type": "string", "description": "Website công ty (mặc định: https://fermat.edu.vn)"},
        },
        "additionalProperties": False,
    },
)
def signature_generate_html(
    ctx: Dict[str, Any],
    full_name: str = "",
    job_title: str = "",
    department: str = "",
    phone: str = "",
    email: str = "",
    website: str = "https://fermat.edu.vn",
    **_kwargs,
) -> Dict[str, Any]:
    profile = ctx.get("profile")
    name_val = full_name or (profile.name if profile and getattr(profile, "name", "") else ctx.get("email", "").split("@")[0])
    title_val = job_title or (profile.job_title.name if profile and getattr(profile, "job_title", None) else "")
    dept_val = department or (profile.department.name if profile and getattr(profile, "department", None) else "")
    phone_val = phone or (getattr(profile, "phone", "") if profile else "")
    email_val = email or ctx.get("email", "")

    title_part = f"{title_val} | {dept_val}" if (title_val and dept_val) else (title_val or dept_val or "Cán bộ nhân viên")

    html = f"""<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, sans-serif; font-size: 13px; color: #1e293b; line-height: 1.4;">
  <tr>
    <td style="padding-right: 16px; border-right: 2px solid #0055da; vertical-align: top; text-align: center;">
      <img src="https://workspace.fermat.vn/logo.png" alt="FermatTech" width="80" style="display: block; margin: 0 auto 6px auto; border-radius: 6px;" onerror="this.style.display='none'" />
      <span style="font-size: 11px; font-weight: bold; color: #0055da; letter-spacing: 0.5px;">FERMATTECH</span>
    </td>
    <td style="padding-left: 16px; vertical-align: top;">
      <div style="font-size: 15px; font-weight: bold; color: #0f172a; margin-bottom: 2px;">{name_val}</div>
      <div style="font-size: 12px; color: #0055da; font-weight: 600; margin-bottom: 8px;">{title_part}</div>
      <table cellpadding="0" cellspacing="0" border="0" style="font-size: 12px; color: #475569;">
        {f'<tr><td style="padding-bottom: 3px;"><strong>Hotline/Zalo:</strong> <a href="tel:{phone_val}" style="color: #475569; text-decoration: none;">{phone_val}</a></td></tr>' if phone_val else ''}
        <tr><td style="padding-bottom: 3px;"><strong>Email:</strong> <a href="mailto:{email_val}" style="color: #0055da; text-decoration: none;">{email_val}</a></td></tr>
        <tr><td style="padding-bottom: 3px;"><strong>Website:</strong> <a href="{website}" style="color: #0055da; text-decoration: none;" target="_blank">{website.replace('https://', '').replace('http://', '')}</a></td></tr>
        <tr><td style="color: #64748b; font-size: 11px; padding-top: 4px;"><strong>CÔNG TY CỔ PHẦN CÔNG NGHỆ FERMAT</strong><br/>Trụ sở: Hà Nội, Việt Nam</td></tr>
      </table>
    </td>
  </tr>
</table>"""

    return {
        "success": True,
        "name": name_val,
        "title": title_part,
        "phone": phone_val,
        "email": email_val,
        "website": website,
        "signature_html": html,
    }
