from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

import os
from django.http import HttpResponse, JsonResponse
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, renderer_classes
from rest_framework.permissions import AllowAny
from rest_framework.renderers import BaseRenderer, JSONRenderer

from .registry import ToolRegistry
from .security import (
    MCPPermissionDenied,
    check_tool_permission,
    log_mcp_audit,
    resolve_user_context,
)

# Nạp tất cả các module tools để tự động đăng ký vào ToolRegistry
from . import (  # noqa: F401
    tools_attendance,
    tools_auth,
    tools_company_accounts,
    tools_crm,
    tools_customers,
    tools_documents,
    tools_email,
    tools_examination,
    tools_finance,
    tools_schedule,
    tools_social,
    tools_system,
    tools_training,
)

logger = logging.getLogger(__name__)


def _cors(response):
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, DELETE"
    response["Access-Control-Allow-Headers"] = (
        "Content-Type, Authorization, X-AI-Key, X-API-Key, X-User-Email, X-User-Password, X-Auth-Token"
    )
    return response


@api_view(["GET", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
def oauth_protected_resource(request):
    """RFC 9728 - OAuth 2.0 Protected Resource Metadata.

    Tra ve metadata de client (Claude, Cursor, ChatGPT) biet may chu nay khong
    dung OAuth flow ma chi chap nhan Bearer token (AI Access Key ft_ai_...)
    qua header hoac URL (?key=ft_ai_...).

    Neu endpoint nay tra 404 hoac HTML, claude.ai / Cursor se hien loi
    'Khong the tu dong xac dinh cai dat OAuth'.
    """
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=status.HTTP_200_OK))
    env_server = os.getenv("MCP_SERVER_URL", "").strip()
    if env_server:
        resource_url = env_server
    else:
        host = request.get_host()
        scheme = "https" if request.is_secure() else "http"
        resource_url = f"{scheme}://{host}/api/mcp"
    metadata = {
        "resource": resource_url,
        "bearer_methods_supported": ["header", "query"],
    }
    resp = _cors(JsonResponse(metadata, json_dumps_params={"ensure_ascii": False}))
    resp["Cache-Control"] = "no-store"
    return resp


@api_view(["GET", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
def openapi_spec(request):
    """Cung cấp tài liệu OpenAPI 3.1 để kết nối làm Action trong ChatGPT Web."""
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=status.HTTP_200_OK))

    env_server = os.getenv("MCP_SERVER_URL", "").strip()
    if env_server:
        server_url = env_server
    else:
        host = request.get_host()
        scheme = "https" if request.is_secure() else "http"
        server_url = f"{scheme}://{host}/api/mcp"
    spec = ToolRegistry.export_openapi_spec(server_url=server_url)
    return _cors(JsonResponse(spec, json_dumps_params={"ensure_ascii": False, "indent": 2}))


@api_view(["POST", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
def action_invoke(request, tool_name: str):
    """Điểm cuối tiếp nhận yêu cầu gọi Tool từ ChatGPT Web (Custom GPT Action)."""
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=status.HTTP_200_OK))

    tool = ToolRegistry.get_tool(tool_name)
    if not tool:
        return _cors(JsonResponse({"error": f"Không tìm thấy công cụ '{tool_name}'."}, status=status.HTTP_404_NOT_FOUND))

    body = request.data if isinstance(request.data, dict) else {}

    # 1. Xác thực tài khoản người dùng
    ctx = None
    if tool.requires_auth:
        try:
            ctx = resolve_user_context(request, body_params=body)
        except Exception as exc:
            return _cors(JsonResponse({
                "success": False,
                "error": "Chưa xác thực tài khoản",
                "message": str(exc),
            }, status=status.HTTP_401_UNAUTHORIZED))

        # 2. Kiểm tra phân quyền truy cập
        try:
            check_tool_permission(ctx, tool)
        except MCPPermissionDenied as exc:
            return _cors(JsonResponse(
                {
                    "success": False,
                    "error": "Từ chối quyền truy cập (Permission Denied)",
                    "message": exc.message,
                    "required_role": exc.required_role,
                    "module": exc.module,
                },
                status=status.HTTP_403_FORBIDDEN,
            ))
    else:
        # Tool không bắt buộc auth (như auth_login)
        try:
            ctx = resolve_user_context(request, body_params=body)
        except Exception:
            ctx = None

    # 3. Thực thi công cụ
    try:
        result = tool.handler(ctx, **body)
        if ctx:
            log_mcp_audit(ctx, tool, body, result)
        return _cors(JsonResponse({"success": True, "data": result}, json_dumps_params={"ensure_ascii": False}))
    except Exception as exc:
        logger.exception(f"Lỗi khi thực thi tool '{tool_name}': {exc}")
        return _cors(JsonResponse(
            {"success": False, "error": f"Lỗi nội bộ khi xử lý công cụ '{tool_name}': {str(exc)}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        ))


SUPPORTED_PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")

SERVER_INSTRUCTIONS = (
    "FTWorkspace MCP: công cụ nghiệp vụ của Fermat Workspace (Đào tạo số, Khảo thí, Lịch công tác, "
    "Chấm công, Văn bản, Email...). Mọi thao tác chạy theo quyền của tài khoản đã kết nối. "
    "Nếu chỉ thấy công cụ đăng nhập, nghĩa là chưa có Mã kết nối AI: hãy tạo mã ở Hồ sơ cá nhân > "
    "Trợ lý AI & MCP rồi thêm vào header Authorization: Bearer ft_ai_... hoặc vào URL ?key=ft_ai_..."
    " Mật khẩu (tài khoản AI của khách hàng, tài khoản công ty) bị che mặc định: chỉ yêu cầu hiển thị khi người dùng "
    "hỏi rõ, mỗi lần xem đều được ghi nhật ký. Trước khi gọi công cụ xóa hoặc ghi đè dữ liệu, hãy xác nhận lại với người dùng."
)


def _rpc_error(req_id, code: int, message: str) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def _rpc_result(req_id, result: Dict[str, Any]) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _tool_text_result(req_id, text: str, *, is_error: bool) -> Dict[str, Any]:
    return _rpc_result(req_id, {"content": [{"type": "text", "text": text}], "isError": is_error})


def _handle_rpc_message(request, message: Any) -> Optional[Dict[str, Any]]:
    """Xử lý một message JSON-RPC. Trả về None với notification (không có id)."""
    if not isinstance(message, dict):
        return _rpc_error(None, -32600, "Invalid Request")

    method = message.get("method")
    req_id = message.get("id")
    params = message.get("params") or {}
    if not isinstance(params, dict):
        params = {}

    # Notification (không có id) hoặc response từ client: không trả lời, view trả HTTP 202
    if "id" not in message or not method:
        return None

    if method == "initialize":
        requested = str(params.get("protocolVersion") or "")
        version = requested if requested in SUPPORTED_PROTOCOL_VERSIONS else SUPPORTED_PROTOCOL_VERSIONS[0]
        return _rpc_result(req_id, {
            "protocolVersion": version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "FTWorkspace-MCP", "version": "1.2.0"},
            "instructions": SERVER_INSTRUCTIONS,
        })

    if method == "ping":
        return _rpc_result(req_id, {})
    if method == "resources/list":
        return _rpc_result(req_id, {"resources": []})
    if method == "resources/templates/list":
        return _rpc_result(req_id, {"resourceTemplates": []})
    if method == "prompts/list":
        return _rpc_result(req_id, {"prompts": []})

    if method == "tools/list":
        try:
            ctx = resolve_user_context(request)
        except Exception:
            ctx = None
        available_tools = []
        for tool in ToolRegistry.list_all_tools():
            if not tool.requires_auth:
                available_tools.append(tool.to_mcp_format())
                continue
            if ctx:
                try:
                    check_tool_permission(ctx, tool)
                    available_tools.append(tool.to_mcp_format())
                except MCPPermissionDenied:
                    continue
        return _rpc_result(req_id, {"tools": available_tools})

    if method == "tools/call":
        tool_name = params.get("name")
        tool_args = params.get("arguments") or {}
        if not isinstance(tool_args, dict):
            tool_args = {}
        tool = ToolRegistry.get_tool(tool_name)
        if not tool:
            return _rpc_error(req_id, -32602, f"Không tìm thấy công cụ '{tool_name}'")

        ctx = None
        if tool.requires_auth:
            # Lỗi xác thực trả về kết quả isError (HTTP 200) để AI đọc được hướng dẫn.
            # Không trả HTTP 401: client MCP sẽ tưởng cần OAuth và báo lỗi khó hiểu.
            try:
                ctx = resolve_user_context(request, body_params=tool_args)
            except Exception as exc:
                return _tool_text_result(req_id, f"Xác thực thất bại: {exc}", is_error=True)
            try:
                check_tool_permission(ctx, tool)
            except MCPPermissionDenied as exc:
                return _tool_text_result(req_id, f"Từ chối quyền truy cập: {exc.message}", is_error=True)
        else:
            try:
                ctx = resolve_user_context(request, body_params=tool_args)
            except Exception:
                ctx = None

        try:
            result = tool.handler(ctx, **tool_args)
            if ctx:
                log_mcp_audit(ctx, tool, tool_args, result)
            return _tool_text_result(
                req_id, json.dumps(result, ensure_ascii=False, indent=2, default=str), is_error=False
            )
        except TypeError as exc:
            return _tool_text_result(req_id, f"Tham số không hợp lệ cho '{tool_name}': {exc}", is_error=True)
        except Exception as exc:
            logger.exception(f"Lỗi khi thực thi tool '{tool_name}': {exc}")
            return _tool_text_result(req_id, f"Lỗi thực thi: {exc}", is_error=True)

    return _rpc_error(req_id, -32601, f"Method '{method}' không được hỗ trợ.")


class _EventStreamRenderer(BaseRenderer):
    """Chỉ để DRF chấp nhận header "Accept: text/event-stream" của client MCP.

    Không có renderer này, GET mở luồng SSE bị DRF trả 406 trước khi vào view,
    trong khi đặc tả yêu cầu 405; client (mcp-remote, Claude Code) coi 406 là lỗi kết nối.
    View luôn trả HttpResponse/JsonResponse nên renderer không thực sự được dùng.
    """
    media_type = "text/event-stream"
    format = "sse"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return b""


MCP_RENDERERS = [JSONRenderer, _EventStreamRenderer]


def _serve_mcp(request):
    """Streamable HTTP (JSON-RPC 2.0).

    - POST một message hoặc một mảng message: trả JSON; chỉ có notification thì trả 202.
    - GET: máy chủ không mở luồng SSE riêng nên trả 405 (đúng đặc tả).
    """
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=status.HTTP_200_OK))
    if request.method == "DELETE":
        return _cors(HttpResponse(status=status.HTTP_200_OK))
    if request.method == "GET":
        response = JsonResponse(
            {"error": "Máy chủ MCP này dùng Streamable HTTP: gửi POST JSON-RPC tới URL /api/mcp."},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
            json_dumps_params={"ensure_ascii": False},
        )
        response["Allow"] = "POST, OPTIONS"
        return _cors(response)

    try:
        payload = request.data
    except Exception:
        payload = None

    if isinstance(payload, list):
        if not payload:
            return _cors(JsonResponse(_rpc_error(None, -32600, "Invalid Request")))
        replies = [r for r in (_handle_rpc_message(request, m) for m in payload) if r is not None]
        if not replies:
            return _cors(HttpResponse(status=status.HTTP_202_ACCEPTED))
        return _cors(JsonResponse(replies, safe=False, json_dumps_params={"ensure_ascii": False}))

    if not isinstance(payload, dict) or not payload:
        return _cors(JsonResponse(_rpc_error(None, -32700, "Parse error")))

    reply = _handle_rpc_message(request, payload)
    if reply is None:
        return _cors(HttpResponse(status=status.HTTP_202_ACCEPTED))
    return _cors(JsonResponse(reply, json_dumps_params={"ensure_ascii": False}))


@api_view(["GET", "POST", "DELETE", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
@renderer_classes(MCP_RENDERERS)
def json_rpc(request):
    """Điểm cuối MCP chính: /api/mcp (và đường cũ /api/mcp/rpc)."""
    return _serve_mcp(request)


@api_view(["GET", "POST", "DELETE", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
@renderer_classes(MCP_RENDERERS)
def sse_endpoint(request):
    """Đường cũ /api/mcp/sse.

    Bản SSE cũ gửi một sự kiện rồi đóng luồng nên client treo. Nay POST xử lý như
    Streamable HTTP; GET trả 405 để client chuyển sang Streamable HTTP thay vì chờ mãi.
    """
    return _serve_mcp(request)


@api_view(["POST", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
@renderer_classes(MCP_RENDERERS)
def messages_endpoint(request):
    """Tương thích ngược: nhận JSON-RPC như /api/mcp."""
    return _serve_mcp(request)


@api_view(["GET", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
def list_my_keys(request):
    """Liệt kê các mã kết nối AI của tài khoản đang đăng nhập."""
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=status.HTTP_200_OK))
    from .keys import list_ai_keys
    try:
        ctx = resolve_user_context(request)
    except Exception as exc:
        return _cors(JsonResponse({"success": False, "error": str(exc)}, status=status.HTTP_401_UNAUTHORIZED))
    keys = list_ai_keys(ctx["email"])
    return _cors(JsonResponse({"success": True, "keys": keys}))


@api_view(["POST", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
def create_my_key(request):
    """Tạo mã kết nối AI mới (AI Access Key) cho tài khoản đang đăng nhập."""
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=status.HTTP_200_OK))
    from .keys import create_ai_key
    try:
        ctx = resolve_user_context(request)
    except Exception as exc:
        return _cors(JsonResponse({"success": False, "error": str(exc)}, status=status.HTTP_401_UNAUTHORIZED))
    name = str(request.data.get("name") or "Trợ lý AI").strip()
    key_info = create_ai_key(ctx["email"], name=name)
    return _cors(JsonResponse({"success": True, "key": key_info}, status=status.HTTP_201_CREATED))


@api_view(["POST", "DELETE", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
def revoke_my_key(request, key_id: str):
    """Thu hồi mã kết nối AI."""
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=status.HTTP_200_OK))
    from .keys import revoke_ai_key
    try:
        ctx = resolve_user_context(request)
    except Exception as exc:
        return _cors(JsonResponse({"success": False, "error": str(exc)}, status=status.HTTP_401_UNAUTHORIZED))
    success = revoke_ai_key(ctx["email"], key_id)
    return _cors(JsonResponse({"success": success}))

