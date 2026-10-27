"""Endpoint OAuth 2.1 cho MCP.

Luồng: AI gọi /mcp không có token -> 401 kèm resource_metadata -> đọc /.well-known/* ->
tự đăng ký (/api/oauth/register) -> mở /api/oauth/authorize cho người dùng đăng nhập ->
đổi mã lấy token ở /api/oauth/token -> gọi /mcp với Bearer ft_oat_...
"""
from __future__ import annotations

import json

from django.contrib.auth import authenticate
from django.core import signing
from django.http import HttpResponse, HttpResponseRedirect, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from rest_framework.authtoken.models import Token

from authentication import login_throttle

from . import services
from .services import OAuthError

SIGNING_SALT = "mcp-oauth-authorize"
REQUEST_MAX_AGE = 15 * 60


def _cors(response):
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response["Access-Control-Allow-Headers"] = "Authorization, Content-Type, MCP-Protocol-Version"
    response["Cache-Control"] = "no-store"
    return response


def _json(data, status=200):
    return _cors(JsonResponse(data, status=status, json_dumps_params={"ensure_ascii": False}))


def _oauth_error(exc: OAuthError):
    response = _json(exc.payload(), status=exc.status)
    if exc.status == 401:
        response["WWW-Authenticate"] = 'Basic realm="FTWorkspace OAuth"'
    return response


def _request_data(request) -> dict:
    if request.content_type == "application/json":
        try:
            data = json.loads(request.body or b"{}")
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}
    return request.POST.dict()


@csrf_exempt
@require_http_methods(["GET", "OPTIONS"])
def protected_resource_metadata(request, suffix=""):
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=204))
    return _json(services.protected_resource_metadata(request, suffix or ""))


@csrf_exempt
@require_http_methods(["GET", "OPTIONS"])
def authorization_server_metadata(request, suffix=""):
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=204))
    return _json(services.authorization_server_metadata(request))


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def register(request):
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=204))
    try:
        data = json.loads(request.body or b"{}")
    except ValueError:
        return _json({"error": "invalid_client_metadata", "error_description": "Body phải là JSON."}, status=400)
    try:
        return _json(services.register_client(data), status=201)
    except OAuthError as exc:
        return _oauth_error(exc)


def _error_page(request, message, status=400):
    return render(request, "mcp_oauth/authorize.html", {"fatal": message}, status=status)


def _page(request, params, client, *, error="", email="", status=200):
    blob = signing.dumps(params, salt=SIGNING_SALT)
    return render(request, "mcp_oauth/authorize.html", {
        "client_name": client.name or services.parts_host(client.client_id),
        "redirect_host": services.parts_host(params["redirect_uri"]),
        "blob": blob,
        "error": error,
        "email": email,
    }, status=status)


def _user_from_post(request):
    """Đăng nhập trên trang cho phép: dùng phiên web đang mở hoặc email/mật khẩu."""
    web_token = str(request.POST.get("web_token") or "").strip()
    if web_token:
        tok = Token.objects.select_related("user").filter(key=web_token).first()
        if tok and tok.user.is_active:
            return tok.user, ""
        return None, "Phiên đăng nhập web đã hết hạn. Hãy nhập email và mật khẩu."

    from authentication.views import _bootstrap_admin, _normalise_email

    email = _normalise_email(request.POST.get("email") or "")
    password = str(request.POST.get("password") or "")
    if not email or not password:
        return None, "Vui lòng nhập email và mật khẩu."
    ip = login_throttle.client_ip(request)
    wait = login_throttle.locked_seconds(email, ip)
    if wait:
        return None, login_throttle.locked_message(wait)
    user = authenticate(request=request, username=email, password=password) or _bootstrap_admin(email, password)
    if user is None:
        login_throttle.register_failure(email, ip)
        return None, "Email hoặc mật khẩu không chính xác."
    login_throttle.register_success(email)
    if not user.is_active:
        return None, "Tài khoản đã bị khóa."
    return user, ""


@csrf_exempt
@require_http_methods(["GET", "POST"])
def authorize(request):
    if request.method == "GET":
        source = request.GET
        try:
            client = services.get_client(source.get("client_id"))
        except OAuthError as exc:
            return _error_page(request, exc.description or exc.error)
        redirect_uri = str(source.get("redirect_uri") or "")
        if not redirect_uri and len(client.redirect_uris) == 1:
            redirect_uri = client.redirect_uris[0]
        if not services.redirect_uri_matches(client.redirect_uris, redirect_uri):
            return _error_page(request, "redirect_uri không khớp với ứng dụng đã đăng ký. Hãy kết nối lại từ đầu.")
        state = str(source.get("state") or "")
        iss = services.base_url(request)

        def fail(error, description):
            return HttpResponseRedirect(services.redirect_with(redirect_uri, {
                "error": error, "error_description": description, "state": state, "iss": iss}))

        if source.get("response_type") != "code":
            return fail("unsupported_response_type", "Chỉ hỗ trợ response_type=code.")
        challenge = str(source.get("code_challenge") or "")
        if not challenge or source.get("code_challenge_method", "S256") != "S256":
            return fail("invalid_request", "Cần PKCE với code_challenge_method=S256.")
        params = {
            "client_id": client.client_id,
            "redirect_uri": redirect_uri,
            "state": state,
            "code_challenge": challenge,
            "scope": str(source.get("scope") or "mcp")[:200],
            "resource": str(source.get("resource") or "")[:500],
        }
        return _page(request, params, client)

    try:
        params = signing.loads(request.POST.get("request", ""), salt=SIGNING_SALT, max_age=REQUEST_MAX_AGE)
        client = services.get_client(params["client_id"])
    except (signing.BadSignature, KeyError, OAuthError):
        return _error_page(request, "Phiên cho phép đã hết hạn. Quay lại ứng dụng AI và kết nối lại.")
    iss = services.base_url(request)
    if request.POST.get("action") == "deny":
        return HttpResponseRedirect(services.redirect_with(params["redirect_uri"], {
            "error": "access_denied", "error_description": "Người dùng từ chối.", "state": params["state"], "iss": iss}))
    user, error = _user_from_post(request)
    if user is None:
        return _page(request, params, client, error=error, email=str(request.POST.get("email") or ""), status=400)
    code = services.create_authorization_code(
        client, user, params["redirect_uri"], params["code_challenge"], params["scope"], params["resource"])
    return HttpResponseRedirect(services.redirect_with(params["redirect_uri"], {
        "code": code, "state": params["state"], "iss": iss}))


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def token(request):
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=204))
    data = _request_data(request)
    try:
        client = services.authenticate_client(request, data)
        grant_type = data.get("grant_type")
        if grant_type == "authorization_code":
            body = services.exchange_code(client, data)
        elif grant_type == "refresh_token":
            body = services.refresh_tokens(client, data)
        else:
            raise OAuthError("unsupported_grant_type", "Chỉ hỗ trợ authorization_code và refresh_token.")
    except OAuthError as exc:
        return _oauth_error(exc)
    response = _json(body)
    response["Pragma"] = "no-cache"
    return response


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def revoke(request):
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=204))
    data = _request_data(request)
    try:
        client = services.authenticate_client(request, data)
    except OAuthError as exc:
        return _oauth_error(exc)
    if data.get("token"):
        services.revoke_token(str(data["token"]), client)
    return _cors(HttpResponse(status=200))
