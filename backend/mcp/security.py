from __future__ import annotations

import base64
import json
import logging
import uuid
from typing import Any, Dict, Optional, Tuple

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from rest_framework import exceptions
from rest_framework.authtoken.models import Token

from authentication.auth import DjangoTokenAuthentication, get_admin_emails
from authentication.models import UserProfile
from authentication.views import _bootstrap_admin, _normalise_email
from examination.models import LogNote
from .keys import verify_ai_key
from .registry import MCPTool

logger = logging.getLogger(__name__)

ROLE_LEVELS = {
    "VIEWER": 1,
    "EMPLOYEE": 2,
    "MANAGER": 3,
    "ADMIN": 4,
}


class MCPPermissionDenied(Exception):
    def __init__(self, message: str, required_role: Optional[str] = None, module: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.required_role = required_role
        self.module = module


def authenticate_by_credentials(email: str, password: str, request=None):
    """Xác thực tài khoản người dùng trực tiếp bằng Email và Mật khẩu của hệ thống FTWorkspace."""
    clean_email = _normalise_email(email)
    clean_password = str(password or "")
    if not clean_email or not clean_password:
        return None

    http_request = getattr(request, "_request", request)
    django_user = authenticate(request=http_request, username=clean_email, password=clean_password)
    if django_user is None:
        django_user = authenticate(username=clean_email, password=clean_password)

    if django_user is None:
        user_candidate = User.objects.filter(email__iexact=clean_email).first()
        if not user_candidate:
            user_candidate = User.objects.filter(username__iexact=clean_email).first()
        if user_candidate and user_candidate.check_password(clean_password):
            django_user = user_candidate

    if django_user is None:
        django_user = _bootstrap_admin(clean_email, clean_password)

    if django_user and not getattr(django_user, "is_active", True):
        return None
    return django_user


def _find_or_create_user_by_email(email: str) -> Optional[User]:
    email_clean = email.strip().lower()
    if not email_clean:
        return None
    user = User.objects.filter(email__iexact=email_clean).first()
    if not user:
        user = User.objects.filter(username__iexact=email_clean).first()
    if not user:
        user, _ = User.objects.get_or_create(
            username=email_clean,
            defaults={"email": email_clean, "is_active": True},
        )
    return user


def resolve_user_context(request, body_params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Xác thực linh hoạt đa phương thức:

    1. AI Access Key (Mã kết nối AI riêng: ft_ai_...)
    2. HTTP Basic Auth: Authorization: Basic base64(email:password) - Tài khoản mật khẩu hệ thống
    3. Session Token / Auth Token trong body tham số (phục vụ đăng nhập qua tool auth_login)
    4. Custom Headers (X-AI-Key, X-User-Email & X-User-Password, X-Auth-Token)
    5. DRF Token / Bearer Token
    6. Phiên đăng nhập web Django Session (nếu gọi từ trình duyệt)
    """
    django_user = None

    # 1. Kiểm tra session/DRF user đã xác thực sẵn
    candidate_user = getattr(request, "django_user", None) or getattr(request, "user", None)
    if candidate_user and getattr(candidate_user, "is_authenticated", False):
        django_user = candidate_user

    # 2. Kiểm tra Authorization header (Basic, Bearer hoặc AI Key)
    if django_user is None:
        auth_header = ""
        if hasattr(request, "META"):
            auth_header = str(request.META.get("HTTP_AUTHORIZATION", "") or "").strip()
        if not auth_header and hasattr(request, "headers"):
            auth_header = str(request.headers.get("Authorization", "") or "").strip()

        if auth_header:
            parts = auth_header.split(None, 1)
            scheme = parts[0].lower() if parts else ""
            credential = parts[1].strip() if len(parts) > 1 else ""

            # 2a. AI Access Key dạng Bearer ft_ai_... hoặc ft_ai_... trực tiếp
            if credential.startswith("ft_ai_") or auth_header.startswith("ft_ai_"):
                raw_k = credential if credential.startswith("ft_ai_") else auth_header
                matched_email = verify_ai_key(raw_k)
                if matched_email:
                    django_user = _find_or_create_user_by_email(matched_email)

            # 2b. HTTP Basic Auth (Email & Mật khẩu hệ thống)
            elif scheme == "basic" and credential:
                try:
                    decoded = base64.b64decode(credential).decode("utf-8", errors="ignore")
                    username, sep, password = decoded.partition(":")
                    if sep:
                        # Có thể nhập mã ft_ai_ làm password hoặc username
                        if username.startswith("ft_ai_") or password.startswith("ft_ai_"):
                            k = username if username.startswith("ft_ai_") else password
                            matched_email = verify_ai_key(k)
                            if matched_email:
                                django_user = _find_or_create_user_by_email(matched_email)
                        if django_user is None:
                            django_user = authenticate_by_credentials(username, password, request=request)
                except Exception as exc:
                    logger.debug(f"Lỗi giải mã Basic Auth: {exc}")

            # 2c. DRF Token Auth
            elif scheme in {"bearer", "token"} and credential and credential not in {"null", "undefined"}:
                tok = Token.objects.select_related("user").filter(key=credential).first()
                if tok and getattr(tok.user, "is_active", True):
                    django_user = tok.user

    # 3. Kiểm tra Custom Headers (X-AI-Key, X-User-Email + X-User-Password hoặc X-Auth-Token)
    if django_user is None and hasattr(request, "META"):
        header_ai_key = (
            request.META.get("HTTP_X_AI_KEY")
            or request.META.get("HTTP_X_API_KEY")
            or request.META.get("HTTP_API_KEY")
        )
        header_email = request.META.get("HTTP_X_USER_EMAIL")
        header_pass = request.META.get("HTTP_X_USER_PASSWORD")
        header_token = request.META.get("HTTP_X_AUTH_TOKEN")

        if header_ai_key:
            clean_k = str(header_ai_key).strip()
            if clean_k.lower().startswith("bearer "):
                clean_k = clean_k[7:].strip()
            matched_email = verify_ai_key(clean_k)
            if matched_email:
                django_user = _find_or_create_user_by_email(matched_email)
        elif header_email and header_pass:
            django_user = authenticate_by_credentials(header_email, header_pass, request=request)
        elif header_token:
            if header_token.startswith("ft_ai_"):
                matched_email = verify_ai_key(header_token.strip())
                if matched_email:
                    django_user = _find_or_create_user_by_email(matched_email)
            else:
                tok = Token.objects.select_related("user").filter(key=header_token).first()
                if tok and getattr(tok.user, "is_active", True):
                    django_user = tok.user

    # 4. Kiểm tra tham số trong body (auth_email + auth_password hoặc session_token / auth_token)
    params = body_params or (request.data if hasattr(request, "data") and isinstance(request.data, dict) else {})
    if django_user is None and isinstance(params, dict):
        body_token = str(params.get("session_token") or params.get("auth_token") or params.get("ai_key") or "").strip()
        body_email = params.get("auth_email")
        body_pass = params.get("auth_password")

        if body_token.startswith("ft_ai_"):
            matched_email = verify_ai_key(body_token)
            if matched_email:
                django_user = _find_or_create_user_by_email(matched_email)
        elif body_token:
            tok = Token.objects.select_related("user").filter(key=body_token).first()
            if tok and getattr(tok.user, "is_active", True):
                django_user = tok.user
        elif body_email and body_pass:
            django_user = authenticate_by_credentials(str(body_email), str(body_pass), request=request)

    # Nếu vẫn không xác thực được
    if django_user is None:
        raise exceptions.AuthenticationFailed(
            "Yêu cầu chưa được xác thực. Bạn có thể dùng Mã kết nối AI (AI Access Key: ft_ai_...), "
            "tài khoản hệ thống (Email và Mật khẩu) thông qua HTTP Basic Auth, "
            "hoặc gọi công cụ 'auth_login' ngay trong cuộc trò chuyện."
        )

    # Thiết lập UserProfile và quyền hạn
    email = (django_user.email or django_user.username or "").strip().lower()
    if not email:
        raise exceptions.AuthenticationFailed("Tài khoản chưa có email hợp lệ.")

    profile, _ = UserProfile.objects.get_or_create(
        email=email,
        defaults={
            "name": django_user.get_full_name() or django_user.username or email.split("@", 1)[0],
            "role": "EMPLOYEE",
        },
    )

    role = getattr(request, "user_role", None) or profile.role or "EMPLOYEE"
    if role not in ROLE_LEVELS:
        role = "EMPLOYEE"
    if django_user.is_superuser or email in get_admin_emails():
        role = "ADMIN"

    access_modules = getattr(request, "access_modules", None)
    if access_modules is None:
        access_modules = set(profile.access_modules or [])
    else:
        access_modules = set(access_modules)

    if role == "ADMIN":
        # Admin có toàn quyền trên tất cả các phân hệ
        access_modules = {
            "digital-training",
            "examination",
            "work-schedule",
            "attendance",
            "finance-report",
            "account-management",
            "documents",
            "social-dashboard",
            "email-builder",
            "system",
            "auth",
        }

    department_names = [getattr(getattr(profile, "department", None), "name", "")]
    job_title = getattr(getattr(profile, "job_title", None), "name", "")

    return {
        "django_user": django_user,
        "profile": profile,
        "email": email,
        "name": profile.name,
        "role": role,
        "access_modules": access_modules,
        "department_names": department_names,
        "job_title": job_title,
        "request": request,
    }


def is_accountant(ctx: Dict[str, Any]) -> bool:
    """Kiểm tra xem tài khoản có thuộc bộ phận kế toán hay không."""
    if ctx.get("role") == "ADMIN":
        return True
    identity = f"{ctx.get('job_title', '')} {' '.join(ctx.get('department_names', []))}".lower()
    return "ke toan" in identity or "kế toán" in identity


def check_tool_permission(ctx: Dict[str, Any], tool: MCPTool) -> None:
    """Kiểm tra quyền hạn của tài khoản đối với Tool được yêu cầu."""
    role = ctx.get("role", "VIEWER")
    user_email = ctx.get("email", "")

    # 1. Admin luôn có toàn quyền
    if role == "ADMIN":
        return

    # 2. Phân hệ auth/system ai cũng dùng được
    if tool.module in {"system", "auth"} and tool.min_role == "VIEWER":
        return

    # 3. Kiểm tra quyền truy cập module
    access_modules = ctx.get("access_modules", set())
    # Lịch công tác, chấm công và báo cáo tuần cá nhân mặc định mở cho toàn bộ nhân sự đã xác thực
    is_personal_task = (
        tool.module in {"work-schedule", "attendance", "system", "auth"}
        or tool.name in {"docs_generate_weekly_report", "docs_get_weekly_report"}
    )
    if not is_personal_task:
        if tool.module not in access_modules:
            raise MCPPermissionDenied(
                f"Tài khoản {user_email} (Vai trò: {role}) chưa được phân quyền truy cập phân hệ '{tool.module}'.",
                module=tool.module,
            )

    # 4. Kiểm tra bậc vai trò tối thiểu (Role hierarchy)
    user_level = ROLE_LEVELS.get(role, 1)
    required_level = ROLE_LEVELS.get(tool.min_role or "EMPLOYEE", 2)
    if user_level < required_level:
        raise MCPPermissionDenied(
            f"Thao tác '{tool.name}' yêu cầu vai trò tối thiểu '{tool.min_role}', nhưng vai trò hiện tại của bạn là '{role}'.",
            required_role=tool.min_role,
            module=tool.module,
        )

    # 5. Kiểm tra quyền tài chính chuyên sâu
    if tool.require_finance and not is_accountant(ctx):
        raise MCPPermissionDenied(
            f"Thao tác '{tool.name}' thuộc dữ liệu thu chi nhạy cảm, chỉ dành cho Kế toán hoặc Quản trị viên (Admin).",
            required_role="ADMIN / Kế toán",
            module="finance-report",
        )


def log_mcp_audit(ctx: Dict[str, Any], tool: MCPTool, params: Dict[str, Any], result: Dict[str, Any]) -> None:
    """Ghi lại nhật ký kiểm toán (Audit Log) cho các hành động thay đổi dữ liệu từ AI / MCP."""
    if not tool.audit_action:
        return
    try:
        actor_email = ctx.get("email", "unknown")
        actor_name = ctx.get("name", "Người dùng MCP")
        entity_key = f"mcp:{tool.name}:{uuid.uuid4().hex[:8]}"
        content = (
            f"[AI Plugin/MCP] {tool.audit_action} bởi {actor_name} ({actor_email}). "
            f"Tham số: {json.dumps(params, ensure_ascii=False, default=str)}. "
            f"Kết quả: {json.dumps(result, ensure_ascii=False, default=str)}"
        )
        LogNote.objects.create(
            key=entity_key,
            entity_key=f"mcp-{tool.module}",
            content=content,
            updated_by=f"{actor_name} (qua ChatGPT/MCP)",
            actor_email=actor_email,
            system=False,
        )
    except Exception as exc:
        logger.warning(f"Không thể ghi nhật ký audit MCP: {exc}")
