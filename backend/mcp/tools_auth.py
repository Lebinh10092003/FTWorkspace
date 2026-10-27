from __future__ import annotations

from typing import Any, Dict, Optional

from authentication.models import UserProfile
from .registry import register_tool
from .security import resolve_user_context


@register_tool(
    name="auth_login",
    title="Hướng dẫn kết nối",
    description=(
        "Hướng dẫn kết nối FTWorkspace bằng Mã kết nối AI (ft_ai_...). MCP không nhận mật khẩu tài khoản; "
        "đừng yêu cầu người dùng gõ mật khẩu vào cuộc trò chuyện."
    ),
    module="auth",
    min_role="VIEWER",
    requires_auth=False,
    parameters={"type": "object", "properties": {}, "additionalProperties": True},
)
def auth_login(ctx: Optional[Dict[str, Any]], **_kwargs) -> Dict[str, Any]:
    if ctx:
        return {
            "success": True,
            "message": f"Đã kết nối với tài khoản {ctx.get('name')} ({ctx.get('role')}). Không cần đăng nhập thêm.",
        }
    return {
        "success": False,
        "error": "Chưa có Mã kết nối AI. MCP không nhận email/mật khẩu.",
        "how_to_connect": [
            "Thêm connector với URL https://workspace.fermat.vn/mcp (Authentication: OAuth). Ứng dụng AI sẽ mở trang "
            "đăng nhập FTWorkspace; người dùng đăng nhập trên trang đó là kết nối xong.",
            "Ứng dụng không hỗ trợ OAuth: tạo Mã kết nối AI ở Hồ sơ cá nhân > Trợ lý AI & MCP, dùng URL "
            "https://workspace.fermat.vn/mcp?key=ft_ai_... hoặc header Authorization: Bearer ft_ai_...",
        ],
        "instruction_for_ai": "Không hỏi mật khẩu trong khung chat. Người dùng chỉ đăng nhập trên trang FTWorkspace mà ứng dụng mở ra.",
    }


@register_tool(
    name="auth_status",
    description="Kiểm tra trạng thái đăng nhập hiện tại và xem thông tin tài khoản đang kết nối.",
    module="auth",
    min_role="VIEWER",
    requires_auth=False,
    parameters={
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
)
def auth_status(ctx: Optional[Dict[str, Any]], **_kwargs) -> Dict[str, Any]:
    if ctx and ctx.get("email"):
        return {
            "is_authenticated": True,
            "name": ctx.get("name"),
            "email": ctx.get("email"),
            "role": ctx.get("role"),
            "access_modules": list(ctx.get("access_modules", [])),
            "message": f"Đang đăng nhập với tư cách {ctx.get('name')} ({ctx.get('role')}).",
        }
    return {
        "is_authenticated": False,
        "message": "Chưa có tài khoản nào được đăng nhập. Hãy dùng HTTP Basic Auth hoặc gọi 'auth_login' với email và mật khẩu của bạn.",
    }
