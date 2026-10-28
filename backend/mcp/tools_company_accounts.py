"""Công cụ MCP quản lý tài khoản dịch vụ do công ty sở hữu. Chỉ Admin dùng được."""
from __future__ import annotations

from typing import Any, Dict, Optional

from company_accounts import services
from company_accounts.models import CompanyAccount

from .registry import register_tool

CATEGORY_ENUM = [code for code, _ in CompanyAccount.CATEGORY_CHOICES]
STATUS_ENUM = [code for code, _ in CompanyAccount.STATUS_CHOICES]
BILLING_ENUM = [code for code, _ in CompanyAccount.BILLING_CHOICES]

ACCOUNT_FIELDS: Dict[str, Any] = {
    "name": {"type": "string", "description": "Tên dịch vụ / tài khoản, vd 'Google Workspace – admin'"},
    "category": {"type": "string", "enum": CATEGORY_ENUM},
    "provider": {"type": "string", "description": "Nhà cung cấp, vd Google, OpenAI, Canva, PA Vietnam"},
    "login_url": {"type": "string"},
    "username": {"type": "string", "description": "Email / tên đăng nhập"},
    "password": {"type": "string", "description": "Mật khẩu mới (được mã hóa khi lưu). Bỏ trống để giữ nguyên."},
    "two_factor": {"type": "string", "description": "Nơi nhận mã 2FA (SĐT, thiết bị, app)"},
    "recovery_email": {"type": "string"},
    "recovery_phone": {"type": "string"},
    "owner_email": {"type": "string", "description": "Email nhân viên phụ trách"},
    "department": {"type": "string"},
    "users": {"type": "array", "items": {"type": "string"}, "description": "Người / nhóm đang dùng chung"},
    "plan": {"type": "string", "description": "Gói dịch vụ, vd 'Business Standard', 'Team'"},
    "cost": {"type": "number", "description": "Chi phí mỗi kỳ thanh toán (VND)"},
    "billing_cycle": {"type": "string", "enum": BILLING_ENUM},
    "renewal_date": {"type": "string", "description": "Ngày gia hạn tiếp theo YYYY-MM-DD"},
    "auto_renew": {"type": "boolean"},
    "payment_method": {"type": "string", "description": "Thẻ / tài khoản thanh toán (không ghi số thẻ đầy đủ)"},
    "status": {"type": "string", "enum": STATUS_ENUM},
    "tags": {"type": "array", "items": {"type": "string"}},
    "notes": {"type": "string"},
}
WRITABLE = set(ACCOUNT_FIELDS)


def _find(account_id: Optional[int], name: str = "") -> tuple[Optional[CompanyAccount], str]:
    if account_id:
        account = CompanyAccount.objects.filter(pk=account_id).first()
        return account, "" if account else f"Không có tài khoản công ty ID {account_id}."
    name = str(name or "").strip()
    if not name:
        return None, "Cần account_id hoặc name."
    matches = list(CompanyAccount.objects.filter(name__icontains=name)[:6])
    if len(matches) == 1:
        return matches[0], ""
    if not matches:
        return None, f"Không tìm thấy tài khoản công ty khớp '{name}'."
    listing = "; ".join(f"{a.name} (ID {a.id})" for a in matches[:5])
    return None, f"Có nhiều tài khoản khớp '{name}': {listing}. Hãy dùng account_id."


def _fields(kwargs: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in kwargs.items() if k in WRITABLE and v is not None}


@register_tool(
    name="company_list_accounts",
    title="Danh sách tài khoản công ty",
    description=(
        "Tra cứu các tài khoản dịch vụ do công ty sở hữu (email, AI, thiết kế, mạng xã hội, tên miền, cổng thuế...): "
        "người phụ trách, gói, chi phí, ngày gia hạn. Không trả về mật khẩu; dùng company_get_account_password nếu cần."
    ),
    module="account-management",
    min_role="ADMIN",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Tìm theo tên, nhà cung cấp, tên đăng nhập, người phụ trách"},
            "category": {"type": "string", "enum": ["all", *CATEGORY_ENUM]},
            "status": {"type": "string", "enum": ["all", *STATUS_ENUM]},
            "owner_email": {"type": "string"},
            "renewal_within_days": {"type": "integer", "description": "Chỉ lấy tài khoản đang dùng cần gia hạn trong N ngày tới (kể cả đã quá hạn)"},
        },
        "additionalProperties": False,
    },
)
def company_list_accounts(ctx: Dict[str, Any], query: str = "", category: str = "all", status: str = "all",
                          owner_email: str = "", renewal_within_days: Optional[int] = None, **_kwargs: Any) -> Dict[str, Any]:
    qs = services.filter_accounts(
        CompanyAccount.objects.all(), search=query, category=category, status=status,
        owner=owner_email, renewal_within_days=renewal_within_days,
    )
    rows = [services.account_payload(a) for a in qs[:300]]
    return {"count": len(rows), "accounts": rows}


@register_tool(
    name="company_accounts_overview",
    title="Tổng quan tài khoản công ty",
    description=(
        "Tổng quan tài khoản công ty: số tài khoản theo nhóm, tổng chi phí quy ra mỗi tháng, danh sách sắp/quá hạn gia hạn, "
        "tài khoản chưa có người phụ trách, mật khẩu lâu chưa đổi (trên 180 ngày)."
    ),
    module="account-management",
    min_role="ADMIN",
    parameters={
        "type": "object",
        "properties": {"days_ahead": {"type": "integer", "description": "Số ngày tới để xét sắp gia hạn (mặc định 30)"}},
        "additionalProperties": False,
    },
)
def company_accounts_overview(ctx: Dict[str, Any], days_ahead: int = 30, **_kwargs: Any) -> Dict[str, Any]:
    days = max(1, min(int(days_ahead or 30), 365))
    return services.summary(CompanyAccount.objects.all(), days_ahead=days)


@register_tool(
    name="company_get_account_password",
    title="Xem mật khẩu tài khoản công ty",
    description=(
        "Lấy mật khẩu của một tài khoản công ty. Chỉ gọi khi người dùng yêu cầu rõ ràng. "
        "Mỗi lần xem được ghi vào nhật ký kèm lý do."
    ),
    module="account-management",
    min_role="ADMIN",
    audit_action="Xem mật khẩu tài khoản công ty",
    destructive=False,
    parameters={
        "type": "object",
        "properties": {
            "account_id": {"type": "integer"},
            "name": {"type": "string", "description": "Tên tài khoản nếu không có ID"},
            "reason": {"type": "string", "description": "Lý do cần xem mật khẩu"},
        },
        "required": ["reason"],
        "additionalProperties": False,
    },
)
def company_get_account_password(ctx: Dict[str, Any], reason: str, account_id: Optional[int] = None,
                                 name: str = "", **_kwargs: Any) -> Dict[str, Any]:
    account, error = _find(account_id, name)
    if not account:
        return {"success": False, "error": error}
    if not account.password_encrypted:
        return {"success": False, "error": f"Tài khoản '{account.name}' chưa lưu mật khẩu."}
    password = services.reveal_password(account, ctx.get("email", ""), channel="mcp", reason=str(reason or "")[:300])
    return {
        "success": True,
        "account_id": account.id,
        "name": account.name,
        "login_url": account.login_url,
        "username": account.username,
        "password": password,
        "two_factor": account.two_factor,
    }


@register_tool(
    name="company_create_account",
    title="Thêm tài khoản công ty",
    description=(
        "Thêm một tài khoản dịch vụ của công ty. Mật khẩu được mã hóa khi lưu. Có thể bỏ trống password rồi "
        "nhập mật khẩu trên web. Nhập nhiều tài khoản hoặc dữ liệu từ Google Sheet: dùng "
        "company_import_accounts_from_sheet (máy chủ tự đọc Sheet, mật khẩu không đi qua cuộc trò chuyện)."
    ),
    module="account-management",
    min_role="ADMIN",
    audit_action="Thêm tài khoản công ty",
    parameters={
        "type": "object",
        "properties": ACCOUNT_FIELDS,
        "required": ["name"],
        "additionalProperties": False,
    },
)
def company_create_account(ctx: Dict[str, Any], **kwargs: Any) -> Dict[str, Any]:
    try:
        account = services.save_account(CompanyAccount(), _fields(kwargs), ctx.get("email", ""), channel="mcp")
    except services.AccountValidationError as exc:
        return {"success": False, "error": "Dữ liệu chưa hợp lệ.", "errors": exc.errors}
    return {"success": True, "message": f"Đã thêm tài khoản '{account.name}'.", "account": services.account_payload(account)}


@register_tool(
    name="company_update_account",
    title="Cập nhật tài khoản công ty",
    description=(
        "Cập nhật tài khoản công ty: đổi mật khẩu, người phụ trách, gói, chi phí, ngày gia hạn, trạng thái... "
        "Chỉ gửi trường cần đổi."
    ),
    module="account-management",
    min_role="ADMIN",
    audit_action="Cập nhật tài khoản công ty",
    parameters={
        "type": "object",
        "properties": {
            "account_id": {"type": "integer"},
            "match_name": {"type": "string", "description": "Tên tài khoản cần sửa nếu không có ID"},
            **ACCOUNT_FIELDS,
        },
        "additionalProperties": False,
    },
)
def company_update_account(ctx: Dict[str, Any], account_id: Optional[int] = None, match_name: str = "",
                           **kwargs: Any) -> Dict[str, Any]:
    account, error = _find(account_id, match_name)
    if not account:
        return {"success": False, "error": error}
    changes = _fields(kwargs)
    if not changes:
        return {"success": False, "error": "Không có thông tin nào cần cập nhật."}
    try:
        services.save_account(account, changes, ctx.get("email", ""), channel="mcp")
    except services.AccountValidationError as exc:
        return {"success": False, "error": "Dữ liệu chưa hợp lệ.", "errors": exc.errors}
    return {
        "success": True,
        "message": f"Đã cập nhật tài khoản '{account.name}'.",
        "updated_fields": sorted(changes),
        "account": services.account_payload(account),
    }


@register_tool(
    name="company_delete_account",
    title="Xóa tài khoản công ty",
    description=(
        "Xóa hẳn một tài khoản công ty khỏi danh sách. Nếu chỉ ngừng dùng, hãy dùng company_update_account với "
        "status='cancelled' để giữ lịch sử. Cần confirm=true."
    ),
    module="account-management",
    min_role="ADMIN",
    audit_action="Xóa tài khoản công ty",
    parameters={
        "type": "object",
        "properties": {
            "account_id": {"type": "integer"},
            "confirm": {"type": "boolean", "description": "Phải là true để xác nhận xóa"},
        },
        "required": ["account_id", "confirm"],
        "additionalProperties": False,
    },
)
def company_delete_account(ctx: Dict[str, Any], account_id: int, confirm: bool = False, **_kwargs: Any) -> Dict[str, Any]:
    if confirm is not True:
        return {"success": False, "error": "Chưa xác nhận. Gọi lại với confirm=true nếu chắc chắn muốn xóa."}
    account, error = _find(account_id)
    if not account:
        return {"success": False, "error": error}
    name = account.name
    services.delete_account(account, ctx.get("email", ""), channel="mcp")
    return {"success": True, "message": f"Đã xóa tài khoản '{name}'."}
