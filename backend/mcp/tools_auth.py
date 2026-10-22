from __future__ import annotations

from typing import Any, Dict
from rest_framework.authtoken.models import Token

from authentication.models import UserProfile
from .registry import register_tool
from .security import authenticate_by_credentials, resolve_user_context


@register_tool(
    name="auth_login",
    description="Đăng nhập trực tiếp bằng Email và Mật khẩu tài khoản thông thường của hệ thống FTWorkspace ngay trong cuộc trò chuyện.",
    module="auth",
    min_role="VIEWER",
    requires_auth=False,
    parameters={
        "type": "object",
        "properties": {
            "email": {
                "type": "string",
                "description": "Email tài khoản nhân viên / quản trị viên FTWorkspace",
            },
            "password": {
                "type": "string",
                "description": "Mật khẩu đăng nhập tài khoản hệ thống",
            },
        },
        "required": ["email", "password"],
        "additionalProperties": False,
    },
)
def auth_login(ctx: Optional[Dict[str, Any]], email: str, password: str, **_kwargs) -> Dict[str, Any]:
    django_user = authenticate_by_credentials(email, password)
    if django_user is None:
        return {
            "success": False,
            "error": "Tên đăng nhập (email) hoặc mật khẩu hệ thống không chính xác.",
        }

    token, _ = Token.objects.get_or_create(user=django_user)
    email_clean = (django_user.email or django_user.username or "").strip().lower()
    profile, _ = UserProfile.objects.get_or_create(
        email=email_clean,
        defaults={
            "name": django_user.get_full_name() or django_user.username or email_clean.split("@", 1)[0],
            "role": "EMPLOYEE",
        },
    )

    role = profile.role or "EMPLOYEE"
    if django_user.is_superuser:
        role = "ADMIN"

    access_modules = list(profile.access_modules or [])
    if role == "ADMIN":
        access_modules = [
            "digital-training",
            "examination",
            "work-schedule",
            "attendance",
            "finance-report",
            "account-management",
            "documents",
            "social-dashboard",
            "email-builder",
        ]

    return {
        "success": True,
        "message": f"Đăng nhập thành công với tài khoản {profile.name} ({role}).",
        "session_token": token.key,
        "user": {
            "name": profile.name,
            "email": profile.email,
            "role": role,
            "department": profile.department.name if profile.department else "",
            "job_title": profile.job_title.name if profile.job_title else "",
            "access_modules": access_modules,
        },
        "instruction_for_ai": (
            f"Tài khoản {profile.name} ({role}) đã xác thực thành công. "
            f"Hãy tự động gắn tham số 'session_token': '{token.key}' vào các công cụ tiếp theo nếu cần thiết."
        ),
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
