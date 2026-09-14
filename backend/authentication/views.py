import base64
import binascii
import hashlib
import json
import os
import re
import urllib.parse
import uuid
from datetime import timedelta
from pathlib import Path

import requests
from django.conf import settings
from django.apps import apps
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from integrations.google_sheets import (
    build_sheets_service,
    extract_spreadsheet_id,
    initialize_sheets_structure,
)
from .auth import get_admin_emails
from .models import (
    Department, JobTitle, SystemConfig, UserLogin, UserProfile,
    WorkspaceNotification, WorkspaceNotificationRead,
)
from .notifications import (
    max_notification_cutoff, notification_visible_to, notify_workspace,
    read_notification_cutoff,
)
from .monthly_sheets import (
    MODULES as MONTHLY_SHEET_MODULES,
    get_monthly_sheet_links,
    set_monthly_sheet_link,
    valid_month,
    valid_sheet_url,
)
from .permissions import IsAdmin, IsAuthenticated, IsManagerOrAdmin, IsWorkspaceAuthenticated, request_role

User = get_user_model()
VALID_ROLES = {"ADMIN", "MANAGER", "EMPLOYEE", "VIEWER"}
GOOGLE_FORM_SHORT_HOST = "forms.gle"
GOOGLE_FORM_DESTINATION_HOST = "docs.google.com"
GOOGLE_FORM_ALLOWED_HOSTS = {GOOGLE_FORM_SHORT_HOST, GOOGLE_FORM_DESTINATION_HOST}
SENSITIVE_CONFIG_KEYS = {
    "metaPageTokensJson",
    "zaloOaTokensJson",
    "detailedTokensList",
    "facebookScanTokens",
    "cronSecret",
    "googleServiceAccountJson",
    "lastGoogleAccessToken",
    "lastGoogleAccessTokenTime",
}


def _normalise_email(value: str) -> str:
    email = str(value or "").strip().lower()
    if email and "@" not in email:
        email = f"{email}@ftsocial.com"
    return email


def _client_ip(request) -> str:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()[:50]
    return str(request.META.get("REMOTE_ADDR", ""))[:50]


class GoogleFormLinkError(Exception):
    def __init__(self, message: str, *, temporary: bool = False):
        super().__init__(message)
        self.temporary = temporary


def _validated_google_form_url(value: str, *, require_short_host: bool = False) -> urllib.parse.ParseResult:
    try:
        parsed = urllib.parse.urlparse(str(value or "").strip())
        port = parsed.port
    except (TypeError, ValueError):
        raise GoogleFormLinkError("Liên kết Google Forms không đúng định dạng.")

    hostname = str(parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https" or parsed.username or parsed.password or port not in (None, 443):
        raise GoogleFormLinkError("Liên kết Google Forms phải dùng HTTPS và không chứa thông tin đăng nhập.")
    if hostname not in GOOGLE_FORM_ALLOWED_HOSTS or (require_short_host and hostname != GOOGLE_FORM_SHORT_HOST):
        raise GoogleFormLinkError("Chỉ có thể xác minh liên kết rút gọn từ forms.gle.")
    if not parsed.path or parsed.path == "/":
        raise GoogleFormLinkError("Liên kết forms.gle đang thiếu mã biểu mẫu.")
    if hostname == GOOGLE_FORM_DESTINATION_HOST and not parsed.path.startswith("/forms/"):
        raise GoogleFormLinkError("Liên kết chuyển hướng không dẫn tới một Google Form.")
    return parsed


def _resolve_google_form_short_url(value: str) -> str:
    current = urllib.parse.urlunparse(_validated_google_form_url(value, require_short_host=True))
    headers = {"User-Agent": "Fermat-Workspace-QR-Link-Validator/1.0"}

    for _ in range(5):
        parsed = _validated_google_form_url(current)
        try:
            response = requests.get(
                current,
                allow_redirects=False,
                headers=headers,
                timeout=(4, 8),
            )
        except requests.RequestException as exc:
            raise GoogleFormLinkError(
                "Chưa thể kết nối Google để xác minh liên kết. Vui lòng thử lại hoặc dùng URL đầy đủ từ Google Forms.",
                temporary=True,
            ) from exc

        try:
            if response.status_code in {301, 302, 303, 307, 308}:
                location = str(response.headers.get("Location") or "").strip()
                if not location:
                    raise GoogleFormLinkError("Liên kết rút gọn không cung cấp địa chỉ chuyển hướng.")
                current = urllib.parse.urljoin(current, location)
                destination = _validated_google_form_url(current)
                if str(destination.hostname or "").lower().rstrip(".") == GOOGLE_FORM_DESTINATION_HOST:
                    return urllib.parse.urlunparse(destination)
                continue

            if response.status_code == 429 or response.status_code >= 500:
                raise GoogleFormLinkError(
                    "Google đang tạm giới hạn việc kiểm tra liên kết. Vui lòng thử lại sau hoặc dùng URL đầy đủ từ Google Forms.",
                    temporary=True,
                )

            body = str(getattr(response, "text", "") or "")[:50000].lower()
            if response.status_code >= 400 or "invalid dynamic link" in body:
                raise GoogleFormLinkError(
                    "Liên kết forms.gle không còn hợp lệ hoặc đã bị thiếu ký tự. Hãy sao chép lại liên kết dành cho người trả lời."
                )
            raise GoogleFormLinkError(
                "Không tìm thấy biểu mẫu đích từ liên kết này. Hãy dùng URL đầy đủ dạng docs.google.com/forms/..."
            )
        finally:
            response.close()

    raise GoogleFormLinkError("Liên kết chuyển hướng qua quá nhiều bước và không thể xác minh an toàn.")


def _user_payload(profile: UserProfile) -> dict:
    department = profile.department
    departments = list(profile.departments.all())
    job_title = profile.job_title
    manager = profile.manager
    return {
        "uid": profile.email,
        "email": profile.email,
        "name": profile.name or profile.email.split("@", 1)[0],
        "displayName": profile.name or profile.email.split("@", 1)[0],
        "picture": profile.photo_url or "",
        "photoURL": profile.photo_url or "",
        "role": profile.role,
        "employeeCode": profile.employee_code or "",
        "phone": profile.phone or "",
        "department": {"id": department.id, "name": department.name} if department else None,
        "departments": [{"id": item.id, "name": item.name} for item in departments],
        "jobTitle": {"id": job_title.id, "name": job_title.name} if job_title else None,
        "manager": {"email": manager.email, "name": manager.name or manager.email} if manager else None,
        "startDate": profile.start_date.isoformat() if profile.start_date else None,
        "employmentStatus": profile.employment_status or "ACTIVE",
        "accessModules": sorted(WORKSPACE_MODULES) if profile.role == "ADMIN" else [item for item in (profile.access_modules or []) if item in WORKSPACE_MODULES],
        "lastLogin": profile.last_login.isoformat() if profile.last_login else None,
        "updatedAt": profile.updated_at.isoformat(),
    }
def _record_login(request, profile: UserProfile) -> None:
    now = timezone.now()
    UserLogin.objects.create(
        id=f"login_{int(now.timestamp() * 1000)}_{uuid.uuid4().hex[:8]}",
        email=profile.email,
        name=profile.name or "",
        role=profile.role,
        login_at=now,
        user_agent=str(request.META.get("HTTP_USER_AGENT", ""))[:5000],
        ip=_client_ip(request),
    )


def _profile_for_user(django_user) -> UserProfile:
    email = _normalise_email(django_user.email or django_user.username)
    profile, _ = UserProfile.objects.get_or_create(
        email=email,
        defaults={
            "name": django_user.get_full_name() or django_user.username,
            "role": "EMPLOYEE",
        },
    )
    role = profile.role if profile.role in VALID_ROLES else "EMPLOYEE"
    if django_user.is_superuser or email in get_admin_emails():
        role = "ADMIN"
    profile.role = role
    profile.name = profile.name or django_user.get_full_name() or django_user.username
    profile.save()
    return profile


def _bootstrap_admin_credentials() -> list[tuple[str, str]]:
    """Return all configured emergency admin credentials."""
    credentials: list[tuple[str, str]] = []
    raw = str(os.getenv("BOOTSTRAP_ADMINS_JSON", "") or "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                parsed = [parsed]
            if isinstance(parsed, list):
                for item in parsed:
                    if not isinstance(item, dict):
                        continue
                    configured_email = _normalise_email(item.get("email"))
                    configured_password = str(item.get("password") or "")
                    if configured_email and configured_password:
                        credentials.append((configured_email, configured_password))
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    configured_email = _normalise_email(os.getenv("BOOTSTRAP_ADMIN_EMAIL", ""))
    configured_password = str(os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "") or "")
    if configured_email and configured_password:
        credentials.append((configured_email, configured_password))
    unique: dict[str, str] = {}
    for configured_email, configured_password in credentials:
        unique[configured_email] = configured_password
    return list(unique.items())


def _bootstrap_admin(email: str, password: str):
    configured_password = dict(_bootstrap_admin_credentials()).get(email)
    if not configured_password or password != configured_password:
        return None
    django_user, created = User.objects.get_or_create(
        username=email,
        defaults={"email": email, "is_staff": True, "is_superuser": True, "is_active": True},
    )
    if created or not django_user.check_password(configured_password):
        django_user.set_password(configured_password)
    django_user.email = email
    django_user.is_staff = True
    django_user.is_superuser = True
    django_user.is_active = True
    django_user.save()
    return django_user

TOKEN_LIFETIME_DAYS = 60
TOKEN_WARNING_DAYS = 1


def _token_dates(previous: dict | None, access_token: str, now) -> tuple[str, str]:
    if previous and str(previous.get("accessToken") or "") == access_token:
        issued_at = str(previous.get("issuedAt") or "").strip()
        expires_at = str(previous.get("expiresAt") or "").strip()
        if issued_at and expires_at:
            return issued_at, expires_at
    return now.isoformat(), (now + timedelta(days=TOKEN_LIFETIME_DAYS)).isoformat()


def _is_placeholder_token(item: dict) -> bool:
    return (
        str(item.get("id") or "").strip() == "facebook-current-token"
        or str(item.get("pageId") or "").strip() == "current-facebook-token"
    )


def _normalise_token_rows(rows, previous_rows, now, scan_tokens=None):
    previous_by_id = {
        str(item.get("id") or ""): item
        for item in previous_rows if isinstance(item, dict) and item.get("id")
    }
    scan_tokens = [item for item in (scan_tokens or []) if isinstance(item, dict)]
    scans_by_id = {str(item.get("id") or ""): item for item in scan_tokens}
    normalised = []
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        if _is_placeholder_token(item):
            continue
        token_id = str(item.get("id") or "").strip()
        platform = str(item.get("platform") or "").strip().lower()
        page_id = str(item.get("pageId") or "").strip()
        access_token = str(item.get("accessToken") or "").strip()
        if not token_id or platform not in {"facebook", "zalo", "mock"} or not page_id or not access_token:
            continue

        source_token = scans_by_id.get(str(item.get("sourceTokenId") or ""))
        if source_token is None:
            matching_scans = [
                scan for scan in scan_tokens
                if page_id in [str(value) for value in scan.get("pageIds", [])]
            ]
            if matching_scans:
                source_token = max(matching_scans, key=lambda scan: str(scan.get("issuedAt") or ""))
        if source_token and source_token.get("issuedAt") and source_token.get("expiresAt"):
            issued_at = str(source_token["issuedAt"])
            expires_at = str(source_token["expiresAt"])
            source_token_id = str(source_token.get("id") or "")
        else:
            issued_at, expires_at = _token_dates(previous_by_id.get(token_id), access_token, now)
            source_token_id = ""

        item.update({
            "id": token_id,
            "platform": platform,
            "pageId": page_id,
            "pageName": str(item.get("pageName") or "").strip() or f"{platform} {page_id}",
            "accessToken": access_token,
            "issuedAt": issued_at,
            "expiresAt": expires_at,
        })
        if source_token_id:
            item["sourceTokenId"] = source_token_id
        else:
            item.pop("sourceTokenId", None)
        normalised.append(item)
    return normalised


def _normalise_scan_tokens(rows, previous_rows, now):
    previous_by_id = {
        str(item.get("id") or ""): item
        for item in previous_rows if isinstance(item, dict) and item.get("id")
    }
    normalised = []
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        token_id = str(item.get("id") or "").strip()
        access_token = str(item.get("accessToken") or "").strip()
        if not token_id or not access_token:
            continue
        issued_at, expires_at = _token_dates(previous_by_id.get(token_id), access_token, now)
        previous = previous_by_id.get(token_id) or {}
        token_changed = str(previous.get("accessToken") or "") != access_token
        page_names = [str(value).strip() for value in item.get("pageNames", []) if str(value).strip()]
        page_ids = [str(value).strip() for value in item.get("pageIds", []) if str(value).strip()]
        label = str(item.get("label") or "").strip()
        if not label or "?" in label or label.lower().startswith("token qu"):
            label = "Token quét Facebook (hiện tại)" if token_id == "facebook-scan-current" else "Token quét Facebook"
        item.update({
            "id": token_id,
            "platform": "facebook",
            "label": label,
            "accessToken": access_token,
            "issuedAt": issued_at,
            "expiresAt": expires_at,
            "pageIds": page_ids,
            "pageNames": page_names,
        })
        if token_changed:
            item["validationStatus"] = "unknown"
            item.pop("lastValidatedAt", None)
            item.pop("lastValidationError", None)
        normalised.append(item)
    return normalised


def _sync_environment_scan_token(data: dict, now) -> bool:
    """Seed the environment token only when the database has no scan token.

    An environment secret is a deployment bootstrap value, not an authority
    that may silently replace a token saved later by an administrator.
    """
    access_token = str(os.getenv("CURRENT_FACEBOOK_ACCESS_TOKEN", "") or "").strip()
    if not access_token:
        return False
    rows = [item for item in data.get("facebookScanTokens", []) if isinstance(item, dict)]
    if any(str(item.get("accessToken") or "").strip() for item in rows):
        return False
    rows.append({
        "id": "facebook-scan-current",
        "platform": "facebook",
        "label": "Token quét Facebook (hiện tại)",
        "accessToken": access_token,
        "issuedAt": now.isoformat(),
        "expiresAt": (now + timedelta(days=TOKEN_LIFETIME_DAYS)).isoformat(),
        "validationStatus": "unknown",
        "pageIds": [],
        "pageNames": [],
    })
    data["facebookScanTokens"] = rows
    return True

def _days_remaining(expires_at: str, now) -> tuple[int, object] | None:
    try:
        parsed = timezone.datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed)
        days = max(0, int(max(0, (parsed - now).total_seconds() + 86399) // 86400))
        return days, parsed
    except (TypeError, ValueError):
        return None

def _seed_config() -> dict:
    now = timezone.now()
    scan_tokens = []
    current_facebook_token = os.getenv("CURRENT_FACEBOOK_ACCESS_TOKEN", "").strip()
    if current_facebook_token:
        ttl_days = TOKEN_LIFETIME_DAYS
        scan_tokens.append({
            "id": "facebook-scan-current",
            "platform": "facebook",
            "label": "Token quét Facebook",
            "accessToken": current_facebook_token,
            "issuedAt": now.isoformat(),
            "expiresAt": (now + timedelta(days=ttl_days)).isoformat(),
            "pageIds": [],
            "pageNames": [],
        })
    return {
        "metaPageTokensJson": os.getenv("META_PAGE_TOKENS_JSON", "{}"),
        "zaloOaTokensJson": os.getenv("ZALO_OA_TOKENS_JSON", "{}"),
        "detailedTokensList": [],
        "facebookScanTokens": scan_tokens,
        "cronSecret": os.getenv("CRON_SECRET", ""),
        "adminEmails": os.getenv("ADMIN_EMAILS", ""),
        "spreadsheetId": "",
        "googleServiceAccountJson": os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", ""),
        "autoSyncEnabled": True,
        "updatedAt": timezone.now().isoformat(),
    }


def _get_config() -> SystemConfig:
    config, created = SystemConfig.objects.get_or_create(key="main")
    if created or not config.data:
        config.data = _seed_config()
        config.admin_emails = config.data.get("adminEmails") or ""
        config.save()
    else:
        data = dict(config.data or {})
        rows = list(data.get("detailedTokensList") or [])
        raw_scan_tokens = list(data.get("facebookScanTokens") or [])
        now = timezone.now()
        scan_tokens = _normalise_scan_tokens(raw_scan_tokens, raw_scan_tokens, now)
        if not scan_tokens:
            scan_source = next(
                (item for item in rows if isinstance(item, dict) and _is_placeholder_token(item)),
                None,
            )
            if scan_source:
                facebook_pages = [
                    item for item in rows
                    if isinstance(item, dict)
                    and item.get("platform") == "facebook"
                    and not _is_placeholder_token(item)
                ]
                scan_tokens = _normalise_scan_tokens([{
                    "id": "facebook-scan-current",
                    "platform": "facebook",
                    "label": "Token quét Facebook",
                    "accessToken": scan_source.get("accessToken", ""),
                    "issuedAt": scan_source.get("issuedAt", ""),
                    "expiresAt": scan_source.get("expiresAt", ""),
                    "pageIds": [item.get("pageId", "") for item in facebook_pages],
                    "pageNames": [item.get("pageName", "") for item in facebook_pages],
                }], [], now)
        normalised_rows = _normalise_token_rows(rows, rows, now, scan_tokens)
        data["facebookScanTokens"] = scan_tokens
        env_token_changed = _sync_environment_scan_token(data, now)
        scan_tokens = _normalise_scan_tokens(data.get("facebookScanTokens", []), data.get("facebookScanTokens", []), now)
        data["facebookScanTokens"] = scan_tokens
        env_token_changed = env_token_changed or scan_tokens != raw_scan_tokens
        if env_token_changed:
            normalised_rows = _normalise_token_rows(rows, rows, now, scan_tokens)
        if normalised_rows != rows or data != config.data:
            data["detailedTokensList"] = normalised_rows
            data["updatedAt"] = now.isoformat()
            config.data = data
            config.save(update_fields=["data"])
    return config


def _sync_channels(tokens: list[dict]) -> list[str]:
    from social.models import Channel

    now = timezone.now()
    active_pairs: set[tuple[str, str]] = set()
    created_channel_ids: list[str] = []
    for token in tokens:
        platform = str(token.get("platform") or "").strip().lower()
        page_id = str(token.get("pageId") or "").strip()
        if platform not in {"facebook", "zalo", "mock"} or not page_id or _is_placeholder_token(token):
            continue
        active_pairs.add((platform, page_id))
        name = str(token.get("pageName") or "").strip() or f"{platform} {page_id}"
        channel = Channel.objects.filter(platform=platform, external_id=page_id).first()
        if channel:
            channel.name = name
            channel.status = "active"
            channel.updated_at = now
            channel.save(update_fields=["name", "status", "updated_at"])
        else:
            channel = Channel.objects.create(
                id=str(uuid.uuid4()),
                platform=platform,
                name=name,
                external_id=page_id,
                status="active",
                timezone="Asia/Ho_Chi_Minh",
                created_at=now,
                updated_at=now,
            )
            created_channel_ids.append(channel.id)

    for channel in Channel.objects.filter(status="active"):
        if (channel.platform, channel.external_id) not in active_pairs:
            channel.status = "inactive"
            channel.updated_at = now
            channel.save(update_fields=["status", "updated_at"])

    return created_channel_ids


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"status": "ok"})


@api_view(["POST"])
@permission_classes([AllowAny])
def resolve_google_form_link(request):
    raw_url = str(request.data.get("url") or "").strip()
    cache_key = "qr-google-form:" + hashlib.sha256(raw_url.encode("utf-8")).hexdigest()
    cached = cache.get(cache_key)
    if isinstance(cached, dict):
        return Response(cached["payload"], status=cached["status"])

    client_key = "qr-google-form-rate:" + hashlib.sha256(_client_ip(request).encode("utf-8")).hexdigest()
    if cache.add(client_key, 1, timeout=60):
        request_count = 1
    else:
        try:
            request_count = cache.incr(client_key)
        except ValueError:
            cache.set(client_key, 1, timeout=60)
            request_count = 1
    if request_count > 30:
        return Response(
            {"error": "Bạn đã kiểm tra quá nhiều liên kết trong một phút. Vui lòng thử lại sau.", "temporary": True},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    try:
        resolved_url = _resolve_google_form_short_url(raw_url)
    except GoogleFormLinkError as exc:
        response_status = status.HTTP_503_SERVICE_UNAVAILABLE if exc.temporary else status.HTTP_400_BAD_REQUEST
        payload = {"error": str(exc), "temporary": exc.temporary}
        if not exc.temporary:
            cache.set(cache_key, {"payload": payload, "status": response_status}, timeout=600)
        return Response(payload, status=response_status)
    payload = {"resolvedUrl": resolved_url, "verified": True}
    cache.set(cache_key, {"payload": payload, "status": status.HTTP_200_OK}, timeout=21600)
    return Response(payload)


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    email = _normalise_email(request.data.get("email") or request.data.get("username"))
    password = str(request.data.get("password") or "")
    if not email or not password:
        return Response({"error": "Vui lòng nhập email và mật khẩu."}, status=status.HTTP_400_BAD_REQUEST)

    django_user = authenticate(request=request, username=email, password=password)
    if django_user is None:
        django_user = _bootstrap_admin(email, password)
    if django_user is None:
        return Response({"error": "Tên đăng nhập hoặc mật khẩu không chính xác."}, status=status.HTTP_401_UNAUTHORIZED)
    if not django_user.is_active:
        return Response({"error": "Tài khoản đã bị khóa."}, status=status.HTTP_403_FORBIDDEN)

    profile = _profile_for_user(django_user)
    profile.last_login = timezone.now()
    profile.save(update_fields=["last_login", "updated_at"])
    _record_login(request, profile)

    # Keep a browser's remembered sign-in valid when the same account signs in
    # elsewhere. The token is still revoked by an explicit logout.
    token, _ = Token.objects.get_or_create(user=django_user)
    return Response({"token": token.key, "user": _user_payload(profile)})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout_view(request):
    if request.auth:
        request.auth.delete()
    return Response({"success": True})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def auth_me(request):
    profile = request.user
    profile.last_login = timezone.now()
    profile.save(update_fields=["last_login", "updated_at"])
    return Response(_user_payload(profile))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def auth_sync(request):
    profile = request.user
    name = str(request.data.get("displayName") or request.data.get("name") or "").strip()
    if name:
        profile.name = name
    profile.last_login = timezone.now()
    profile.save()
    _record_login(request, profile)
    return Response({"success": True, "user": _user_payload(profile)})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def update_profile(request):
    profile = request.user
    display_name = str(request.data.get("displayName") or request.data.get("name") or "").strip()
    photo_url = str(request.data.get("photoURL") or request.data.get("photo_url") or "").strip()
    if display_name:
        profile.name = display_name
    if photo_url:
        profile.photo_url = photo_url
    profile.save()
    return Response(_user_payload(profile))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password(request):
    """Change the signed-in user's password and revoke other remembered sessions."""
    current_password = str(request.data.get("currentPassword") or "")
    new_password = str(request.data.get("newPassword") or "")
    if not current_password or not new_password:
        return Response({"error": "Vui lòng nhập mật khẩu hiện tại và mật khẩu mới."}, status=status.HTTP_400_BAD_REQUEST)

    profile = request.user
    django_user = User.objects.filter(username__iexact=profile.email).first()
    if django_user is None:
        return Response({"error": "Không tìm thấy tài khoản đăng nhập tương ứng."}, status=status.HTTP_404_NOT_FOUND)
    if not django_user.check_password(current_password):
        return Response({"error": "Mật khẩu hiện tại chưa chính xác."}, status=status.HTTP_400_BAD_REQUEST)
    if current_password == new_password:
        return Response({"error": "Mật khẩu mới cần khác mật khẩu hiện tại."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        validate_password(new_password, django_user)
    except ValidationError as exc:
        return Response({"error": " ".join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)

    django_user.set_password(new_password)
    django_user.save(update_fields=["password"])
    Token.objects.filter(user=django_user).delete()
    token = Token.objects.create(user=django_user)
    return Response({"success": True, "token": token.key, "user": _user_payload(_profile_for_user(django_user))})

EMPLOYMENT_STATUSES = {"ACTIVE", "SUSPENDED", "TERMINATED", "PENDING"}
WORKSPACE_MODULES = {
    "work-schedule",
    "social-dashboard",
    "attendance",
    "email-builder",
    "signature-builder",
    "qr-generator",
    "examination",
    "digital-training",
    "finance-report",
}


@api_view(["GET", "PUT"])
@permission_classes([IsAdmin])
def monthly_sheet_links(request):
    month = str(request.query_params.get("month") or request.data.get("month") or timezone.localdate().strftime("%Y-%m")).strip()
    if not valid_month(month):
        return Response({"error": "Tháng không hợp lệ; dùng định dạng YYYY-MM."}, status=status.HTTP_400_BAD_REQUEST)
    if request.method == "PUT":
        module = str(request.data.get("module") or "").strip()
        url = str(request.data.get("url") or "").strip()
        if module not in MONTHLY_SHEET_MODULES:
            return Response({"error": "Phân hệ trang tính không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
        if not valid_sheet_url(url):
            return Response({"error": "Vui lòng nhập đúng liên kết Google Sheets hoặc tệp Excel trên Google Drive."}, status=status.HTTP_400_BAD_REQUEST)
        links = set_monthly_sheet_link(module, month, url, request.user.email)
    else:
        links = get_monthly_sheet_links(month)
    return Response({"month": month, "links": links, "adminOnly": True})
# These are ordinary workspace tools.  New staff should receive them without an
# administrator having to make the same selections for every account.
DEFAULT_ACCESS_MODULES = {"work-schedule", "attendance", "email-builder", "signature-builder", "qr-generator"}
DEFAULT_DEPARTMENTS = (
    ("Kế toán", "ACCOUNTING"),
    ("Truyền thông", "MEDIA"),
    ("Công nghệ", "TECH"),
    ("Đào tạo số", "DIGITAL_TRAINING"),
    ("Khảo thí", "EXAMINATION"),
)


def _ensure_default_departments():
    """Keep the employee directory useful on a newly installed workspace."""
    for name, code in DEFAULT_DEPARTMENTS:
        Department.objects.get_or_create(
            name=name,
            defaults={"code": code, "is_active": True},
        )


def _category_payload(item):
    return {"id": item.id, "name": item.name, "code": getattr(item, "code", ""), "isActive": item.is_active}


def _employee_filters(request):
    rows = UserProfile.objects.select_related("department", "job_title", "manager").prefetch_related("departments").all().order_by("name", "email")
    search = str(request.query_params.get("search") or "").strip()
    if search:
        from django.db.models import Q
        rows = rows.filter(Q(name__icontains=search) | Q(email__icontains=search) | Q(employee_code__icontains=search) | Q(phone__icontains=search))
    department = str(request.query_params.get("department") or "").strip()
    job_title = str(request.query_params.get("job_title") or "").strip()
    role = str(request.query_params.get("role") or "").strip().upper()
    employment_status = str(request.query_params.get("status") or "").strip().upper()
    if department.isdigit():
        rows = rows.filter(departments__id=int(department)).distinct()
    if job_title.isdigit():
        rows = rows.filter(job_title_id=int(job_title))
    if role in VALID_ROLES:
        rows = rows.filter(role=role)
    if employment_status in EMPLOYMENT_STATUSES:
        rows = rows.filter(employment_status=employment_status)
    return rows


def _get_positive_int(value, default, maximum=100):
    try:
        return max(1, min(int(value), maximum))
    except (TypeError, ValueError):
        return default


def _write_employee(request, profile=None):
    data = request.data or {}
    previous_email = profile.email if profile else ""
    email = _normalise_email(data.get("email") if profile is None or request.user_role == "ADMIN" else previous_email)
    name = str(data.get("name") or "").strip() or email.split("@", 1)[0]
    password = str(data.get("password") or "")
    role = str(data.get("role") or (profile.role if profile else "EMPLOYEE")).upper()
    employment_status = str(data.get("employmentStatus") or data.get("employment_status") or (profile.employment_status if profile else "PENDING")).upper()
    employee_code = str(data.get("employeeCode") or data.get("employee_code") or "").strip() or None
    department_id = data.get("departmentId") if "departmentId" in data else data.get("department_id")
    department_ids = data.get("departmentIds") if "departmentIds" in data else data.get("department_ids")
    if not isinstance(department_ids, list):
        department_ids = [department_id] if department_id not in (None, "") else []
    title_id = data.get("jobTitleId") if "jobTitleId" in data else data.get("job_title_id")
    manager_email = _normalise_email(data.get("managerEmail") if "managerEmail" in data else data.get("manager_email"))
    requested_modules = data.get("accessModules") if "accessModules" in data else data.get("access_modules", profile.access_modules if profile else [])
    access_modules = {str(item) for item in requested_modules} if isinstance(requested_modules, list) else set()
    raw_start_date = data.get("startDate") if "startDate" in data else data.get("start_date")
    start_date = parse_date(str(raw_start_date)) if raw_start_date else None

    if not email:
        return None, Response({"error": "Vui lòng nhập email."}, status=status.HTTP_400_BAD_REQUEST)
    if raw_start_date and not start_date:
        return None, Response({"error": "Ngày bắt đầu không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    if not access_modules.issubset(WORKSPACE_MODULES):
        return None, Response({"error": "Phạm vi truy cập mô-đun không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    if role not in VALID_ROLES:
        return None, Response({"error": "Quyền hệ thống không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    if employment_status not in EMPLOYMENT_STATUSES:
        return None, Response({"error": "Trạng thái nhân sự không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    if role == "ADMIN" and request.user_role != "ADMIN":
        return None, Response({"error": "Chỉ quản trị viên được cấp quyền Quản trị viên."}, status=status.HTTP_403_FORBIDDEN)
    if request.user_role == "MANAGER" and role not in {"EMPLOYEE", "VIEWER"}:
        return None, Response({"error": "Quản lý chỉ được cấp quyền Nhân viên hoặc Chỉ xem."}, status=status.HTTP_403_FORBIDDEN)
    if request.user_role == "MANAGER":
        access_modules = access_modules.intersection(set(request.user.access_modules or []))
    if role == "ADMIN":
        access_modules = set(WORKSPACE_MODULES)
    elif profile is None:
        access_modules.update(DEFAULT_ACCESS_MODULES)
    if employee_code and UserProfile.objects.exclude(email=email).filter(employee_code__iexact=employee_code).exists():
        return None, Response({"error": "Mã nhân viên đã được sử dụng."}, status=status.HTTP_400_BAD_REQUEST)

    requested_department_ids = {str(item).strip() for item in department_ids if str(item).strip()}
    departments = list(Department.objects.filter(pk__in=requested_department_ids))
    if len(departments) != len(requested_department_ids):
        return None, Response({"error": "Phòng ban không tồn tại."}, status=status.HTTP_400_BAD_REQUEST)
    department = departments[0] if departments else None
    job_title = None
    if title_id not in (None, ""):
        job_title = JobTitle.objects.filter(pk=title_id).first()
        if not job_title:
            return None, Response({"error": "Chức danh không tồn tại."}, status=status.HTTP_400_BAD_REQUEST)
    manager = None
    if manager_email:
        manager = UserProfile.objects.filter(email=manager_email).first()
        if not manager:
            return None, Response({"error": "Người quản lý không tồn tại."}, status=status.HTTP_400_BAD_REQUEST)
        if manager.email == email:
            return None, Response({"error": "Nhân viên không thể tự là người quản lý của mình."}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        if profile is None:
            password = password or 'Ft@12345'
            if not password:
                return None, Response({"error": "Vui lòng đặt mật khẩu khởi tạo."}, status=status.HTTP_400_BAD_REQUEST)
            try:
                validate_password(password)
            except ValidationError as exc:
                return None, Response({"error": " ".join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
            django_user = User.objects.filter(username__iexact=email).first()
            if django_user:
                return None, Response({"error": "Email này đã có tài khoản."}, status=status.HTTP_400_BAD_REQUEST)
            django_user = User.objects.create_user(username=email, email=email, password=password)
            profile = UserProfile(email=email)
        else:
            django_user = User.objects.filter(username__iexact=previous_email).first()
            if email != previous_email:
                if request.user_role != "ADMIN":
                    return None, Response({"error": "Chỉ quản trị viên được thay đổi email nhân sự."}, status=status.HTTP_403_FORBIDDEN)
                if UserProfile.objects.exclude(email=previous_email).filter(email=email).exists() or User.objects.exclude(pk=django_user.pk if django_user else None).filter(username__iexact=email).exists():
                    return None, Response({"error": "Email này đã có tài khoản."}, status=status.HTTP_400_BAD_REQUEST)
            if not django_user:
                django_user = User.objects.create_user(username=email, email=email, password=password or None)
            if password:
                try:
                    validate_password(password, django_user)
                except ValidationError as exc:
                    return None, Response({"error": " ".join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
                django_user.set_password(password)

        # Email is the profile primary key.  Create a replacement profile when
        # it changes, then move its relations instead of leaving an orphaned
        # account or attempting to mutate a primary key in place.
        if previous_email and email != previous_email:
            replacement = UserProfile(
                email=email,
                name=name,
                role=role,
                employee_code=employee_code,
                phone=str(data.get("phone") or "").strip(),
                department=department,
                job_title=job_title,
                manager=manager,
                start_date=start_date,
                employment_status=employment_status,
                access_modules=sorted(access_modules),
                photo_url=profile.photo_url,
                last_login=profile.last_login,
            )
            replacement.save()
            replacement.departments.set(departments)
            UserProfile.objects.filter(manager_id=previous_email).update(manager_id=email)
            profile.attendance_records.update(employee_id=email)
            work_item = apps.get_model("work_schedule", "WorkItem")
            work_item.objects.filter(creator_id=previous_email).update(creator_id=email)
            work_item.objects.filter(executor_id=previous_email).update(executor_id=email)
            work_item.objects.filter(reviewed_by_id=previous_email).update(reviewed_by_id=email)
            work_item.supporters.through.objects.filter(userprofile_id=previous_email).update(userprofile_id=email)
            work_item.managers.through.objects.filter(userprofile_id=previous_email).update(userprofile_id=email)
            profile.delete()
            profile = replacement
            Token.objects.filter(user=django_user).delete()
        else:
            profile.name = name
            profile.role = role
            profile.employee_code = employee_code
            profile.phone = str(data.get("phone") or "").strip()
            profile.department = department
            profile.job_title = job_title
            profile.manager = manager
            profile.start_date = start_date
            profile.employment_status = employment_status
            profile.access_modules = sorted(access_modules)
            profile.save()
            profile.departments.set(departments)

        django_user.username = email
        django_user.first_name = name
        django_user.email = email
        django_user.is_active = employment_status == "ACTIVE"
        django_user.save()
        if password:
            Token.objects.filter(user=django_user).delete()
        return profile, None


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def assignable_staff(request):
    """Active employees available for assigning work-calendar roles."""
    rows = UserProfile.objects.filter(employment_status="ACTIVE").order_by("name", "email")
    return Response([
        {"name": profile.name or profile.email.split("@", 1)[0], "email": profile.email}
        for profile in rows
    ])


@api_view(["GET", "POST"])
@permission_classes([IsAdmin])
def manage_users(request):
    if request.method == "POST":
        profile, error_response = _write_employee(request)
        if error_response:
            return error_response
        notify_workspace(
            event_key=f"employee:{profile.email}:created:{int(timezone.now().timestamp())}",
            title="Đã thêm nhân sự", message=f"{_actor_name(request)} đã thêm {profile.name or profile.email} vào FT Workspace.",
            category="personnel", target_roles=["ADMIN", "MANAGER"], action_url="/account-management",
        )
        return Response({"success": True, "message": "Đã thêm nhân viên.", "user": _user_payload(profile)}, status=status.HTTP_201_CREATED)

    page_size = _get_positive_int(request.query_params.get("page_size"), 20, 100)
    page = _get_positive_int(request.query_params.get("page"), 1, 100000)
    rows = _employee_filters(request)
    total = rows.count()
    start = (page - 1) * page_size
    results = [_user_payload(item) for item in rows[start:start + page_size]]
    _ensure_default_departments()
    return Response({
        "results": results,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "departments": [_category_payload(item) for item in Department.objects.all()],
        "jobTitles": [_category_payload(item) for item in JobTitle.objects.all()],
        "currentUserEmail": request.user.email,
    })


@api_view(["PUT", "PATCH", "DELETE"])
@permission_classes([IsAdmin])
def manage_single_user(request, email):
    clean_email = _normalise_email(email)
    profile = UserProfile.objects.filter(email=clean_email).first()
    if not profile:
        return Response({"error": "Không tìm thấy nhân viên."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "DELETE":
        if clean_email == request.user.email:
            return Response({"error": "Không thể tự xóa tài khoản đang đăng nhập."}, status=status.HTTP_400_BAD_REQUEST)
        if request.user_role == "MANAGER" and profile.role not in {"EMPLOYEE", "VIEWER"}:
            return Response({"error": "Quản lý không thể xóa tài khoản quản lý hoặc quản trị viên."}, status=status.HTTP_403_FORBIDDEN)
        if profile.role == "ADMIN" and UserProfile.objects.filter(role="ADMIN").count() <= 1:
            return Response({"error": "Không thể xóa quản trị viên cuối cùng."}, status=status.HTTP_400_BAD_REQUEST)
        django_user = User.objects.filter(username__iexact=clean_email).first()
        if django_user:
            django_user.delete()
        profile.delete()
        notify_workspace(
            event_key=f"employee:{clean_email}:deleted:{int(timezone.now().timestamp())}",
            title="Đã xóa nhân sự", message=f"{_actor_name(request)} đã xóa {profile.name or clean_email} khỏi FT Workspace.",
            severity="warning", category="personnel", target_roles=["ADMIN", "MANAGER"], action_url="/account-management",
        )
        return Response({"success": True, "message": "Đã xóa nhân viên."})

    if clean_email == request.user.email and str(request.data.get("employmentStatus") or request.data.get("employment_status") or "").upper() in {"SUSPENDED", "TERMINATED"}:
        return Response({"error": "Không thể tự khóa hoặc cho nghỉ tài khoản đang đăng nhập."}, status=status.HTTP_400_BAD_REQUEST)
    if request.user_role == "MANAGER" and profile.role not in {"EMPLOYEE", "VIEWER"}:
        return Response({"error": "Quản lý không thể chỉnh sửa quản lý hoặc quản trị viên."}, status=status.HTTP_403_FORBIDDEN)
    updated, error_response = _write_employee(request, profile)
    if error_response:
        return error_response
    notify_workspace(
        event_key=f"employee:{updated.email}:updated:{int(timezone.now().timestamp())}",
        title="Hồ sơ nhân sự thay đổi", message=f"{_actor_name(request)} đã cập nhật hồ sơ của {updated.name or updated.email}.",
        category="personnel", target_roles=["ADMIN", "MANAGER"], action_url="/account-management",
    )
    return Response({"success": True, "message": "Đã cập nhật nhân viên.", "user": _user_payload(updated)})


@api_view(["POST"])
@permission_classes([IsAdmin])
def reset_employee_password(request, email):
    clean_email = _normalise_email(email)
    if clean_email == request.user.email:
        return Response({"error": "Hãy dùng chức năng đổi mật khẩu trong hồ sơ để thay đổi mật khẩu của chính bạn."}, status=status.HTTP_400_BAD_REQUEST)
    profile = UserProfile.objects.filter(email=clean_email).first()
    django_user = User.objects.filter(username__iexact=clean_email).first()
    if not profile or not django_user:
        return Response({"error": "Không tìm thấy nhân viên."}, status=status.HTTP_404_NOT_FOUND)
    if request.user_role == "MANAGER" and profile.role not in {"EMPLOYEE", "VIEWER"}:
        return Response({"error": "Quản lý không thể đặt lại mật khẩu tài khoản này."}, status=status.HTTP_403_FORBIDDEN)
    password = str(request.data.get("password") or "")
    try:
        validate_password(password, django_user)
    except ValidationError as exc:
        return Response({"error": " ".join(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
    django_user.set_password(password)
    django_user.save(update_fields=["password"])
    Token.objects.filter(user=django_user).delete()
    return Response({"success": True, "message": "Đã đặt lại mật khẩu. Nhân viên sẽ đăng nhập lại bằng mật khẩu mới."})


def _category_view(request, model, label):
    if request.method == "GET":
        return Response([_category_payload(item) for item in model.objects.all()])
    if request_role(request) != "ADMIN":
        return Response({"error": "Chỉ quản trị viên được quản lý danh mục này."}, status=status.HTTP_403_FORBIDDEN)
    name = str(request.data.get("name") or "").strip()
    if not name:
        return Response({"error": f"Vui lòng nhập tên {label}."}, status=status.HTTP_400_BAD_REQUEST)
    if model.objects.filter(name__iexact=name).exists():
        return Response({"error": f"{label.capitalize()} đã tồn tại."}, status=status.HTTP_400_BAD_REQUEST)
    item = model.objects.create(name=name, code=str(request.data.get("code") or "").strip()) if model is Department else model.objects.create(name=name)
    notify_workspace(
        event_key=f"catalogue:{model._meta.model_name}:{item.pk}:created",
        title=f"Đã thêm {label}",
        message=f"{_actor_name(request)} đã thêm {label} “{item.name}”.",
        category="personnel", target_roles=["ADMIN", "MANAGER"], action_url="/account-management",
    )
    return Response({"success": True, "item": _category_payload(item)}, status=status.HTTP_201_CREATED)


def _category_detail(request, model, item_id, label):
    item = model.objects.filter(pk=item_id).first()
    if not item:
        return Response({"error": f"Không tìm thấy {label}."}, status=status.HTTP_404_NOT_FOUND)
    if request_role(request) != "ADMIN":
        return Response({"error": "Chỉ quản trị viên được quản lý danh mục này."}, status=status.HTTP_403_FORBIDDEN)
    if request.method == "DELETE":
        hard_delete = str(request.query_params.get("hard") or "").lower() in {"1", "true", "yes"}
        employee_count = item.employees.count()
        if hard_delete:
            if employee_count:
                return Response(
                    {"error": f"{label.capitalize()} đang được gán cho {employee_count} nhân sự. Hãy chuyển chức danh trước khi xóa hẳn."},
                    status=status.HTTP_409_CONFLICT,
                )
            item_name, item_pk = item.name, item.pk
            item.delete()
            notify_workspace(
                event_key=f"catalogue:{model._meta.model_name}:{item_pk}:deleted",
                title=f"Đã xóa {label}", message=f"{_actor_name(request)} đã xóa hẳn {label} “{item_name}”.",
                severity="warning", category="personnel", target_roles=["ADMIN", "MANAGER"], action_url="/account-management",
            )
            return Response({"success": True, "message": f"Đã xóa {label}."})
        item.is_active = False
        item.save(update_fields=["is_active", "updated_at"])
        notify_workspace(
            event_key=f"catalogue:{model._meta.model_name}:{item.pk}:disabled:{int(item.updated_at.timestamp())}",
            title=f"Đã ngừng sử dụng {label}", message=f"{_actor_name(request)} đã ngừng sử dụng {label} “{item.name}”.",
            severity="warning", category="personnel", target_roles=["ADMIN", "MANAGER"], action_url="/account-management",
        )
        return Response({"success": True, "message": f"Đã ngừng sử dụng {label}.", "item": _category_payload(item)})
    name = str(request.data.get("name") or item.name).strip()
    if model.objects.exclude(pk=item.pk).filter(name__iexact=name).exists():
        return Response({"error": f"{label.capitalize()} đã tồn tại."}, status=status.HTTP_400_BAD_REQUEST)
    item.name = name
    item.is_active = bool(request.data.get("isActive", request.data.get("is_active", item.is_active)))
    if model is Department:
        item.code = str(request.data.get("code", item.code) or "").strip()
    item.save()
    notify_workspace(
        event_key=f"catalogue:{model._meta.model_name}:{item.pk}:updated:{int(item.updated_at.timestamp())}",
        title=f"Đã cập nhật {label}", message=f"{_actor_name(request)} đã cập nhật {label} “{item.name}”.",
        category="personnel", target_roles=["ADMIN", "MANAGER"], action_url="/account-management",
    )
    return Response({"success": True, "item": _category_payload(item)})


def _actor_name(request):
    profile = getattr(request, "user", None)
    return str(getattr(profile, "name", "") or getattr(profile, "email", "") or "Hệ thống")


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def workspace_notifications(request):
    profile = request.user
    for token_notice in _token_notification_payloads():
        token_identity = token_notice["id"] or hashlib.sha1(
            f"{token_notice['platform']}|{token_notice['label']}|{'|'.join(token_notice['affectedPages'])}".encode("utf-8")
        ).hexdigest()[:16]
        notify_workspace(
            event_key=f"social-token:{token_identity}:{token_notice['expiresAt']}",
            title=f"Token {token_notice['platformLabel']} sắp hết hạn",
            message=f"Còn {max(0, token_notice['daysRemaining'])} ngày. Ảnh hưởng: {', '.join(token_notice['affectedPages']) or token_notice['label']}.",
            severity="urgent" if token_notice["daysRemaining"] <= 3 else "warning",
            category="social-dashboard",
            action_url="/social-dashboard/config",
            target_modules=["social-dashboard"],
            expires_at=token_notice["expiresAtValue"] + timedelta(days=7),
        )
    rows = WorkspaceNotification.objects.filter(
        created_at__gt=max_notification_cutoff(),
    ).exclude(
        read_receipts__user=profile,
        read_receipts__read_at__lte=read_notification_cutoff(),
    ).prefetch_related("read_receipts").all()[:250]
    visible = [item for item in rows if notification_visible_to(item, profile)][:100]
    read_ids = set(WorkspaceNotificationRead.objects.filter(user=profile, notification__in=visible).values_list("notification_id", flat=True))
    return Response({
        "unreadCount": sum(1 for item in visible if item.pk not in read_ids),
        "notifications": [{
            "id": item.pk, "title": item.title, "message": item.message,
            "severity": item.severity, "category": item.category,
            "actionUrl": item.action_url, "createdAt": item.created_at,
            "read": item.pk in read_ids,
        } for item in visible],
    })


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def read_workspace_notification(request, notification_id):
    notification = WorkspaceNotification.objects.filter(pk=notification_id).first()
    if not notification or not notification_visible_to(notification, request.user):
        return Response({"error": "Không tìm thấy thông báo."}, status=status.HTTP_404_NOT_FOUND)
    WorkspaceNotificationRead.objects.get_or_create(notification=notification, user=request.user)
    return Response({"success": True})


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def read_all_workspace_notifications(request):
    rows = [
        item for item in WorkspaceNotification.objects.filter(
            created_at__gt=max_notification_cutoff()
        )[:250]
        if notification_visible_to(item, request.user)
    ]
    WorkspaceNotificationRead.objects.bulk_create(
        [WorkspaceNotificationRead(notification=item, user=request.user) for item in rows],
        ignore_conflicts=True,
    )
    return Response({"success": True})


@api_view(["GET", "POST"])
@permission_classes([IsAdmin])
def departments_view(request):
    return _category_view(request, Department, "phòng ban")


@api_view(["PUT", "PATCH", "DELETE"])
@permission_classes([IsAdmin])
def department_detail(request, department_id):
    return _category_detail(request, Department, department_id, "phòng ban")


@api_view(["GET", "POST"])
@permission_classes([IsAdmin])
def job_titles_view(request):
    return _category_view(request, JobTitle, "chức danh")


@api_view(["PUT", "PATCH", "DELETE"])
@permission_classes([IsAdmin])
def job_title_detail(request, title_id):
    return _category_detail(request, JobTitle, title_id, "chức danh")


@api_view(["GET"])
@permission_classes([IsAdmin])
def admin_users(request):
    users = UserProfile.objects.all().order_by("-updated_at")
    return Response([_user_payload(item) for item in users])


@api_view(["POST"])
@permission_classes([IsAdmin])
def admin_create_user(request):
    profile, error_response = _write_employee(request)
    if error_response:
        return error_response
    return Response({"success": True, "message": "Tạo tài khoản thành công.", "user": _user_payload(profile)})


@api_view(["POST"])
@permission_classes([IsAdmin])
def admin_delete_user(request):
    email = _normalise_email(request.data.get("email"))
    profile = UserProfile.objects.filter(email=email).first()
    if not profile:
        return Response({"error": "Không tìm thấy nhân viên."}, status=status.HTTP_404_NOT_FOUND)
    if email == request.user.email:
        return Response({"error": "Không thể tự xóa tài khoản đang đăng nhập."}, status=status.HTTP_400_BAD_REQUEST)
    if request.user_role == "MANAGER" and profile.role not in {"EMPLOYEE", "VIEWER"}:
        return Response({"error": "Quản lý không thể xóa tài khoản này."}, status=status.HTTP_403_FORBIDDEN)
    if profile.role == "ADMIN" and UserProfile.objects.filter(role="ADMIN").count() <= 1:
        return Response({"error": "Không thể xóa quản trị viên cuối cùng."}, status=status.HTTP_400_BAD_REQUEST)
    django_user = User.objects.filter(username__iexact=email).first()
    if django_user:
        django_user.delete()
    profile.delete()
    return Response({"success": True, "message": "Đã xóa nhân viên."})

@api_view(["GET"])
@permission_classes([IsAdmin])
def list_logins(request):
    rows = UserLogin.objects.all().order_by("-login_at")[:200]
    return Response([
        {
            "id": row.id,
            "email": row.email,
            "name": row.name,
            "role": row.role,
            "loginAt": row.login_at.isoformat(),
            "userAgent": row.user_agent,
            "ip": row.ip,
        }
        for row in rows
    ])


@api_view(["GET"])
@permission_classes([IsManagerOrAdmin])
def token_notifications(request):
    notifications = _token_notification_payloads()
    return Response({"notifications": [{key: value for key, value in item.items() if key not in {"expiresAtValue", "platformLabel"}} for item in notifications], "warningDays": TOKEN_WARNING_DAYS})


def _token_notification_payloads():
    config = _get_config()
    now = timezone.now()
    notifications = []
    data = config.data or {}
    scan_tokens = [
        item for item in data.get("facebookScanTokens", []) if isinstance(item, dict)
    ]
    scan_token_ids = {str(item.get("id") or "") for item in scan_tokens}
    sources = [
        (item, [item.get("pageName") or item.get("pageId") or "Facebook"])
        for item in data.get("detailedTokensList", [])
        if isinstance(item, dict) and str(item.get("sourceTokenId") or "") not in scan_token_ids
    ]
    sources.extend(
        (item, item.get("pageNames") or item.get("pageIds") or [item.get("label") or "Facebook"])
        for item in scan_tokens
    )
    for item, affected_pages in sources:
        remaining = _days_remaining(str(item.get("expiresAt") or "").strip(), now)
        if not remaining:
            continue
        days_remaining, parsed_expiry = remaining
        if days_remaining <= TOKEN_WARNING_DAYS:
            notifications.append({
                "id": str(item.get("id") or ""),
                "platform": item.get("platform", "facebook"),
                "platformLabel": "Facebook" if item.get("platform", "facebook") == "facebook" else "Zalo",
                "label": item.get("label") or item.get("pageName") or "Token Facebook",
                "affectedPages": [str(page) for page in affected_pages if str(page).strip()],
                "issuedAt": item.get("issuedAt") or "",
                "expiresAt": parsed_expiry.isoformat(),
                "expiresAtValue": parsed_expiry,
                "daysRemaining": days_remaining,
            })
    return notifications


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def system_config_view(request):
    config = _get_config()
    if request.method == "GET":
        data = dict(config.data or {})
        if request.user_role != "ADMIN":
            for key in SENSITIVE_CONFIG_KEYS:
                data.pop(key, None)
        return Response(data)

    if request.user_role != "ADMIN":
        return Response({"error": "Quyền truy cập bị từ chối."}, status=status.HTTP_403_FORBIDDEN)
    payload = dict(request.data or {})
    current = dict(config.data or {})
    now = timezone.now()
    previous_rows = list(current.get("detailedTokensList") or [])
    previous_scan_tokens = list(current.get("facebookScanTokens") or [])
    current.update(payload)
    scan_source = payload.get("facebookScanTokens") if isinstance(payload.get("facebookScanTokens"), list) else previous_scan_tokens
    current["facebookScanTokens"] = _normalise_scan_tokens(scan_source, previous_scan_tokens, now)
    row_source = payload.get("detailedTokensList") if isinstance(payload.get("detailedTokensList"), list) else previous_rows
    current["detailedTokensList"] = _normalise_token_rows(
        row_source,
        previous_rows,
        now,
        current["facebookScanTokens"],
    )
    current["updatedAt"] = now.isoformat()
    config.data = current
    if "adminEmails" in payload:
        config.admin_emails = str(payload.get("adminEmails") or "")
    config.save()
    new_channel_ids = []
    if isinstance(payload.get("detailedTokensList"), list):
        new_channel_ids = _sync_channels(current["detailedTokensList"])
        if new_channel_ids:
            from social.views import _start_background_sync
            _start_background_sync(recent_days=1, history_days=365, channel_ids=new_channel_ids)
    return Response({
        "success": True,
        "message": "Đã lưu cấu hình hệ thống.",
        "detailedTokensList": current.get("detailedTokensList", []),
        "facebookScanTokens": current.get("facebookScanTokens", []),
        "newChannelSyncQueued": len(new_channel_ids),
    })

@api_view(["POST"])
@permission_classes([IsAdmin])
def refresh_facebook_scan_token(request, token_id):
    from social.models import Channel
    from social.providers import FacebookProvider, FacebookRateLimitDeferred
    from social.views import _active_background_request, _start_background_sync

    try:
        result = FacebookProvider().rescan_saved_token(token_id)
    except FacebookRateLimitDeferred as error:
        return Response({"error": str(error), "deferred": True}, status=status.HTTP_429_TOO_MANY_REQUESTS)
    except ValueError as error:
        return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)

    _sync_channels(result["detailedTokensList"])
    page_ids = [item["id"] for item in result["pages"]]
    channel_ids = list(
        Channel.objects.filter(platform="facebook", external_id__in=page_ids, status="active")
        .values_list("id", flat=True)
    )
    request_id = ""
    active_request_id = _active_background_request()
    already_running = bool(active_request_id)
    if active_request_id:
        request_id = active_request_id
    elif channel_ids:
        request_id = _start_background_sync(
            recent_days=1,
            history_days=396,
            channel_ids=channel_ids,
        )
    return Response({
        "success": True,
        "message": (
            "Đã quét lại quyền. Một lượt đồng bộ khác đang chạy nên hệ thống không mở thêm tiến trình; "
            "các kênh mới sẽ được nạp ở lượt an toàn tiếp theo."
            if already_running
            else "Đã quét lại các Trang được cấp quyền và xếp lịch đồng bộ."
        ),
        "pageCount": len(result["pages"]),
        "addedPageCount": len(result["addedPageIds"]),
        "addedPageIds": result["addedPageIds"],
        "syncQueued": 0 if already_running else len(channel_ids),
        "alreadyRunning": already_running,
        "requestId": request_id,
        "detailedTokensList": result["detailedTokensList"],
        "facebookScanTokens": result["facebookScanTokens"],
        "metaPageTokensJson": result["metaPageTokensJson"],
    })


@api_view(["GET", "POST"])
@permission_classes([IsAdmin])
def admin_config(request):
    return system_config_view(request)


@api_view(["POST"])
@permission_classes([IsAdmin])
def setup_sheets(request):
    source = str(request.data.get("spreadsheetId") or "").strip()
    spreadsheet_id = extract_spreadsheet_id(source)
    if not spreadsheet_id:
        return Response({"error": "Spreadsheet ID hoặc URL không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    config = _get_config()
    try:
        service = build_sheets_service(request.google_access_token, config.data or {})
        result = initialize_sheets_structure(service, spreadsheet_id)
    except Exception as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    config.data = {**(config.data or {}), "spreadsheetId": spreadsheet_id, "updatedAt": timezone.now().isoformat()}
    config.save(update_fields=["data"])
    return Response(result)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def upload_image(request):
    try:
        filename = "image"
        mime_type = ""
        file_bytes = b""
        content_type = (request.content_type or "").split(";", 1)[0].strip().lower()

        if content_type in {"image/jpeg", "image/png", "image/gif", "image/webp"}:
            filename = urllib.parse.unquote(request.headers.get("X-File-Name", "image"))
            mime_type = content_type
            file_bytes = request.body
        else:
            data = request.data or {}
            filename = str(data.get("filename") or "image")
            encoded = str(data.get("base64") or "")
            if "," in encoded:
                header, encoded = encoded.split(",", 1)
                if "image/" in header:
                    mime_type = header.split(";", 1)[0].split(":", 1)[1]
            else:
                mime_type = "image/png"
            if encoded:
                try:
                    file_bytes = base64.b64decode(encoded, validate=True)
                except (binascii.Error, ValueError):
                    return Response({"error": "Dữ liệu base64 không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)

        if not file_bytes:
            return Response({"error": "Không nhận diện được tệp hình ảnh."}, status=status.HTTP_400_BAD_REQUEST)
        if len(file_bytes) > settings.MAX_UPLOAD_SIZE:
            return Response({"error": "Ảnh vượt quá giới hạn dung lượng."}, status=status.HTTP_400_BAD_REQUEST)

        signatures = {
            "image/jpeg": (lambda value: value.startswith(b"\xff\xd8\xff"), ".jpg"),
            "image/png": (lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"), ".png"),
            "image/gif": (lambda value: value.startswith((b"GIF87a", b"GIF89a")), ".gif"),
            "image/webp": (lambda value: len(value) >= 12 and value[:4] == b"RIFF" and value[8:12] == b"WEBP", ".webp"),
        }
        validator = signatures.get(mime_type)
        if not validator or not validator[0](file_bytes):
            return Response({"error": "Định dạng ảnh không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)

        safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", Path(filename).stem)[:80] or "image"
        unique_filename = f"{safe_name}_{uuid.uuid4().hex[:12]}{validator[1]}"
        settings.MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
        (settings.MEDIA_ROOT / unique_filename).write_bytes(file_bytes)
        return Response({"success": True, "url": f"{settings.MEDIA_URL}{unique_filename}"})
    except Exception as exc:
        return Response({"error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
