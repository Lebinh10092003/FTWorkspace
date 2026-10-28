"""Logic OAuth 2.1 (PKCE S256 bắt buộc) cho MCP FTWorkspace."""
from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import socket
import urllib.request
from datetime import timedelta
from typing import Optional
from urllib.parse import urlencode, urlsplit, urlunsplit

from django.db import transaction
from django.utils import timezone

from .models import OAuthAuthorizationCode, OAuthClient, OAuthGrant

ACCESS_PREFIX = "ft_oat_"
REFRESH_PREFIX = "ft_ort_"
CODE_TTL = timedelta(minutes=5)
ACCESS_TTL = timedelta(hours=8)
REFRESH_TTL = timedelta(days=60)
LAST_USED_WRITE_INTERVAL = timedelta(minutes=10)
METADATA_DOC_TTL = timedelta(hours=24)
SCOPES = ["mcp"]
MCP_PATHS = ("/mcp", "/api/mcp")
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}
BLOCKED_SCHEMES = {"javascript", "data", "file", "vbscript", "about", "blob"}


class OAuthError(Exception):
    def __init__(self, error: str, description: str = "", status: int = 400):
        super().__init__(description or error)
        self.error = error
        self.description = description
        self.status = status

    def payload(self):
        body = {"error": self.error}
        if self.description:
            body["error_description"] = self.description
        return body


def hash_secret(value: str) -> str:
    return hashlib.sha256(str(value).strip().encode("utf-8")).hexdigest()


def new_secret(prefix: str = "") -> str:
    return prefix + secrets.token_urlsafe(32)


def base_url(request) -> str:
    configured = os.getenv("MCP_PUBLIC_BASE_URL", "").strip().rstrip("/")
    if configured:
        return configured
    return f"{request.scheme}://{request.get_host()}"


def protected_resource_metadata(request, suffix: str = "") -> dict:
    root = base_url(request)
    path = suffix if suffix in MCP_PATHS else "/mcp"
    return {
        "resource": root + path,
        "authorization_servers": [root],
        "scopes_supported": SCOPES,
        "bearer_methods_supported": ["header", "query"],
        "resource_name": "FTWorkspace",
        "resource_documentation": f"{root}/",
    }


def authorization_server_metadata(request) -> dict:
    root = base_url(request)
    return {
        "issuer": root,
        "authorization_endpoint": f"{root}/api/oauth/authorize",
        "token_endpoint": f"{root}/api/oauth/token",
        "registration_endpoint": f"{root}/api/oauth/register",
        "revocation_endpoint": f"{root}/api/oauth/revoke",
        "scopes_supported": SCOPES,
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
        "revocation_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
        "client_id_metadata_document_supported": True,
        "authorization_response_iss_parameter_supported": True,
        "service_documentation": f"{root}/",
    }


# ---------- Redirect URI ----------

def _is_loopback(parts) -> bool:
    return parts.scheme == "http" and (parts.hostname or "").lower() in {"localhost", "127.0.0.1", "::1"}


def validate_redirect_uri(uri: str) -> str:
    uri = str(uri or "").strip()
    try:
        parts = urlsplit(uri)
    except ValueError:
        raise OAuthError("invalid_redirect_uri", "redirect_uri không hợp lệ.")
    scheme = parts.scheme.lower()
    if not scheme or parts.fragment or scheme in BLOCKED_SCHEMES or len(uri) > 2000:
        raise OAuthError("invalid_redirect_uri", f"redirect_uri không được phép: {uri}")
    if scheme == "https" and not parts.netloc:
        raise OAuthError("invalid_redirect_uri", f"redirect_uri thiếu tên miền: {uri}")
    if scheme == "http" and not _is_loopback(parts):
        raise OAuthError("invalid_redirect_uri", "redirect_uri http chỉ dùng cho localhost.")
    return uri


def redirect_uri_matches(registered: list, requested: str) -> bool:
    if requested in registered:
        return True
    # RFC 8252 7.3: ứng dụng chạy trên máy (Claude Code, Cursor) đổi cổng localhost mỗi lần.
    try:
        req = urlsplit(requested)
    except ValueError:
        return False
    if not _is_loopback(req):
        return False
    for item in registered:
        try:
            reg = urlsplit(item)
        except ValueError:
            continue
        if _is_loopback(reg) and reg.hostname == req.hostname and reg.path == req.path:
            return True
    return False


def redirect_with(uri: str, params: dict) -> str:
    parts = urlsplit(uri)
    query = parts.query
    extra = urlencode({k: v for k, v in params.items() if v not in (None, "")})
    query = f"{query}&{extra}" if query else extra
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))


# ---------- Client ----------

def register_client(data: dict) -> dict:
    if not isinstance(data, dict):
        raise OAuthError("invalid_client_metadata", "Dữ liệu đăng ký phải là JSON object.")
    uris = data.get("redirect_uris")
    if not isinstance(uris, list) or not uris:
        raise OAuthError("invalid_redirect_uri", "Cần ít nhất một redirect_uri.")
    redirect_uris = [validate_redirect_uri(u) for u in uris[:20]]
    method = str(data.get("token_endpoint_auth_method") or "none")
    if method not in {"none", "client_secret_post", "client_secret_basic"}:
        raise OAuthError("invalid_client_metadata", f"Không hỗ trợ token_endpoint_auth_method={method}.")
    grant_types = data.get("grant_types") or ["authorization_code", "refresh_token"]
    if "authorization_code" not in grant_types:
        raise OAuthError("invalid_client_metadata", "Cần grant_types authorization_code.")
    name = str(data.get("client_name") or "Ứng dụng AI")[:200]
    client_id = "ftc_" + secrets.token_urlsafe(18)
    secret = new_secret("ftcs_") if method != "none" else ""
    client = OAuthClient.objects.create(
        client_id=client_id,
        client_secret_hash=hash_secret(secret) if secret else "",
        name=name,
        redirect_uris=redirect_uris,
        token_endpoint_auth_method=method,
    )
    body = {
        "client_id": client.client_id,
        "client_id_issued_at": int(client.created_at.timestamp()),
        "client_name": name,
        "redirect_uris": redirect_uris,
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": method,
        "scope": " ".join(SCOPES),
    }
    if secret:
        body["client_secret"] = secret
        body["client_secret_expires_at"] = 0
    return body


def _host_is_public(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except OSError:
        return False
    for info in infos:
        try:
            if not ipaddress.ip_address(info[4][0]).is_global:
                return False
        except ValueError:
            return False
    return bool(infos)


def _fetch_metadata_document(client_id: str) -> dict:
    parts = urlsplit(client_id)
    if parts.scheme != "https" or not parts.hostname or parts.fragment or not _host_is_public(parts.hostname):
        raise OAuthError("invalid_client", "client_id dạng URL phải là https công khai.")
    req = urllib.request.Request(client_id, headers={"Accept": "application/json", "User-Agent": "FTWorkspace-OAuth"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:  # noqa: S310 (đã kiểm tra https + IP công khai)
            raw = resp.read(65537)
    except Exception:
        raise OAuthError("invalid_client", "Không tải được tài liệu client_id.")
    if len(raw) > 65536:
        raise OAuthError("invalid_client", "Tài liệu client_id quá lớn.")
    try:
        doc = json.loads(raw)
    except ValueError:
        raise OAuthError("invalid_client", "Tài liệu client_id không phải JSON.")
    if not isinstance(doc, dict) or doc.get("client_id") != client_id:
        raise OAuthError("invalid_client", "client_id trong tài liệu không khớp URL.")
    return doc


def get_client(client_id: str) -> OAuthClient:
    client_id = str(client_id or "").strip()
    if not client_id:
        raise OAuthError("invalid_client", "Thiếu client_id.")
    client = OAuthClient.objects.filter(client_id=client_id).first()
    is_url = client_id.startswith("https://")
    fresh = client and (not client.is_metadata_document or (
        client.metadata_fetched_at and timezone.now() - client.metadata_fetched_at < METADATA_DOC_TTL))
    if fresh:
        return client
    if not is_url:
        raise OAuthError("invalid_client", "Ứng dụng chưa đăng ký với FTWorkspace. Hãy kết nối lại từ đầu.")
    doc = _fetch_metadata_document(client_id)
    uris = [validate_redirect_uri(u) for u in (doc.get("redirect_uris") or [])[:20]]
    if not uris:
        raise OAuthError("invalid_client", "Tài liệu client_id thiếu redirect_uris.")
    # Một số ứng dụng AI khai private_key_jwt hoặc client_secret_* trong tài liệu client_id.
    # Ta không có bí mật chung với client dạng URL, nên coi như client công khai:
    # PKCE (bắt buộc) và redirect_uri khớp chính xác vẫn bảo vệ luồng cấp mã.
    client, _ =OAuthClient.objects.update_or_create(client_id=client_id, defaults={
        "name": str(doc.get("client_name") or parts_host(client_id))[:200],
        "redirect_uris": uris,
        "token_endpoint_auth_method": "none",
        "is_metadata_document": True,
        "metadata_fetched_at": timezone.now(),
    })
    return client


def parts_host(url: str) -> str:
    return urlsplit(url).hostname or url


def authenticate_client(request, data) -> OAuthClient:
    """Xác thực client ở token endpoint (none, client_secret_post, client_secret_basic)."""
    client_id = str(data.get("client_id") or "")
    secret = str(data.get("client_secret") or "")
    header = request.META.get("HTTP_AUTHORIZATION", "")
    if header.lower().startswith("basic "):
        try:
            from urllib.parse import unquote
            decoded = base64.b64decode(header[6:].strip()).decode("utf-8")
            basic_id, _, basic_secret = decoded.partition(":")
            client_id, secret = unquote(basic_id), unquote(basic_secret)
        except Exception:
            raise OAuthError("invalid_client", "Basic Auth không hợp lệ.", status=401)
    client = get_client(client_id) if client_id else None
    if client is None:
        raise OAuthError("invalid_client", "Thiếu client_id.", status=401)
    if client.client_secret_hash:
        if not secret or not hmac.compare_digest(client.client_secret_hash, hash_secret(secret)):
            raise OAuthError("invalid_client", "client_secret sai.", status=401)
    return client


# ---------- Mã ủy quyền và token ----------

def create_authorization_code(client, user, redirect_uri, code_challenge, scope="", resource="") -> str:
    code = new_secret("ftac_")
    OAuthAuthorizationCode.objects.create(
        code_hash=hash_secret(code), client=client, user=user, redirect_uri=redirect_uri,
        code_challenge=code_challenge, scope=scope or " ".join(SCOPES), resource=resource[:500],
        expires_at=timezone.now() + CODE_TTL,
    )
    return code


def _pkce_ok(verifier: str, challenge: str) -> bool:
    if not verifier or not 43 <= len(verifier) <= 128:
        return False
    digest = hashlib.sha256(verifier.encode("ascii", errors="ignore")).digest()
    computed = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return hmac.compare_digest(computed, challenge)


def _token_response(access, refresh, grant) -> dict:
    return {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": int(ACCESS_TTL.total_seconds()),
        "refresh_token": refresh,
        "scope": grant.scope,
    }


def exchange_code(client, data) -> dict:
    code = str(data.get("code") or "")
    reused_at = None
    with transaction.atomic():
        row = (OAuthAuthorizationCode.objects.select_for_update()
               .select_related("user").filter(code_hash=hash_secret(code)).first())
        if row is None or row.client_id != client.pk:
            raise OAuthError("invalid_grant", "Mã ủy quyền không hợp lệ.")
        reused_at = row.used_at
    if reused_at:
        # Mã bị dùng lại: thu hồi kết nối đã cấp từ mã này (RFC 6749 4.1.2). Làm ngoài giao dịch
        # trên để lỗi trả về không hoàn tác lệnh thu hồi.
        OAuthGrant.objects.filter(client=client, user=row.user, created_at__gte=reused_at,
                                  revoked_at__isnull=True).update(revoked_at=timezone.now())
        raise OAuthError("invalid_grant", "Mã ủy quyền đã được dùng.")
    with transaction.atomic():
        row = OAuthAuthorizationCode.objects.select_for_update().select_related("user").get(pk=row.pk)
        if row.used_at:
            raise OAuthError("invalid_grant", "Mã ủy quyền đã được dùng.")
        if row.expires_at < timezone.now():
            raise OAuthError("invalid_grant", "Mã ủy quyền đã hết hạn.")
        redirect_uri = str(data.get("redirect_uri") or "")
        if redirect_uri and redirect_uri != row.redirect_uri:
            raise OAuthError("invalid_grant", "redirect_uri không khớp.")
        if not _pkce_ok(str(data.get("code_verifier") or ""), row.code_challenge):
            raise OAuthError("invalid_grant", "code_verifier không đúng (PKCE).")
        if not row.user.is_active:
            raise OAuthError("invalid_grant", "Tài khoản đã bị khóa.")
        row.used_at = timezone.now()
        row.save(update_fields=["used_at"])
        access, refresh = new_secret(ACCESS_PREFIX), new_secret(REFRESH_PREFIX)
        now = timezone.now()
        grant = OAuthGrant.objects.create(
            client=client, user=row.user, access_hash=hash_secret(access), refresh_hash=hash_secret(refresh),
            access_expires_at=now + ACCESS_TTL, refresh_expires_at=now + REFRESH_TTL,
            scope=row.scope, resource=row.resource,
        )
    return _token_response(access, refresh, grant)


def refresh_tokens(client, data) -> dict:
    refresh = str(data.get("refresh_token") or "")
    with transaction.atomic():
        grant = (OAuthGrant.objects.select_for_update().select_related("user")
                 .filter(refresh_hash=hash_secret(refresh)).first())
        if grant is None or grant.client_id != client.pk or grant.revoked_at:
            raise OAuthError("invalid_grant", "Refresh token không hợp lệ hoặc đã bị thu hồi.")
        if grant.refresh_expires_at < timezone.now():
            raise OAuthError("invalid_grant", "Refresh token đã hết hạn. Hãy đăng nhập lại.")
        if not grant.user.is_active:
            raise OAuthError("invalid_grant", "Tài khoản đã bị khóa.")
        access, new_refresh = new_secret(ACCESS_PREFIX), new_secret(REFRESH_PREFIX)
        now = timezone.now()
        grant.access_hash = hash_secret(access)
        grant.refresh_hash = hash_secret(new_refresh)
        grant.access_expires_at = now + ACCESS_TTL
        grant.refresh_expires_at = now + REFRESH_TTL
        grant.save(update_fields=["access_hash", "refresh_hash", "access_expires_at", "refresh_expires_at"])
    return _token_response(access, new_refresh, grant)


def verify_access_token(raw: str):
    """Trả về Django User nếu access token còn hiệu lực, ngược lại None."""
    raw = str(raw or "").strip()
    if not raw.startswith(ACCESS_PREFIX):
        return None
    grant = OAuthGrant.objects.select_related("user").filter(access_hash=hash_secret(raw)).first()
    now = timezone.now()
    if grant is None or grant.revoked_at or grant.access_expires_at < now or not grant.user.is_active:
        return None
    if not grant.last_used_at or now - grant.last_used_at > LAST_USED_WRITE_INTERVAL:
        OAuthGrant.objects.filter(pk=grant.pk).update(last_used_at=now)
    return grant.user


def revoke_token(raw: str, client: Optional[OAuthClient] = None) -> None:
    hashed = hash_secret(raw)
    qs = OAuthGrant.objects.filter(revoked_at__isnull=True)
    if client is not None:
        qs = qs.filter(client=client)
    (qs.filter(access_hash=hashed) | qs.filter(refresh_hash=hashed)).update(revoked_at=timezone.now())


def connections_for_email(email: str) -> list:
    rows = (OAuthGrant.objects.select_related("client")
            .filter(user__email__iexact=email, revoked_at__isnull=True, refresh_expires_at__gt=timezone.now()))
    rows = list(rows) + list(OAuthGrant.objects.select_related("client").filter(
        user__username__iexact=email, revoked_at__isnull=True, refresh_expires_at__gt=timezone.now()
    ).exclude(user__email__iexact=email))
    return [{
        "id": grant.pk,
        "client": grant.client.name or parts_host(grant.client.client_id),
        "created_at": grant.created_at.isoformat(),
        "last_used_at": grant.last_used_at.isoformat() if grant.last_used_at else None,
    } for grant in rows]


def revoke_connection_for_email(email: str, grant_id) -> bool:
    qs = OAuthGrant.objects.filter(pk=grant_id, revoked_at__isnull=True)
    qs = qs.filter(user__email__iexact=email) | qs.filter(user__username__iexact=email)
    return qs.update(revoked_at=timezone.now()) > 0
