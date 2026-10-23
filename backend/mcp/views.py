from __future__ import annotations

import json
import logging
from typing import Any, Dict

import os
import uuid
from django.http import HttpResponse, JsonResponse, StreamingHttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny

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
    tools_crm,
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


@api_view(["POST", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
def json_rpc(request):
    """Điểm cuối chuẩn Model Context Protocol (MCP) giao thức JSON-RPC 2.0."""
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=status.HTTP_200_OK))

    rpc_request = request.data if isinstance(request.data, dict) else {}
    if not rpc_request:
        return _cors(JsonResponse({"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error"}, "id": None}))

    method = rpc_request.get("method")
    req_id = rpc_request.get("id")
    params = rpc_request.get("params") or {}

    # 1. Initialize & Ping & Notifications
    if method == "initialize":
        return _cors(JsonResponse({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {"listChanged": False},
                },
                "serverInfo": {
                    "name": "FTWorkspace-MCP",
                    "version": "1.0.0",
                },
            },
        }))

    # Chuẩn MCP: client gửi notification initialized sau khi handshake thành công
    if method in {"notifications/initialized", "initialized"}:
        return _cors(JsonResponse({"jsonrpc": "2.0", "result": {}}))

    if method == "ping":
        return _cors(JsonResponse({"jsonrpc": "2.0", "id": req_id, "result": {}}))

    if method == "resources/list":
        return _cors(JsonResponse({"jsonrpc": "2.0", "id": req_id, "result": {"resources": []}}))

    if method == "prompts/list":
        return _cors(JsonResponse({"jsonrpc": "2.0", "id": req_id, "result": {"prompts": []}}))

    # 2. Xử lý tools/call
    if method == "tools/call":
        tool_name = params.get("name")
        tool_args = params.get("arguments") or {}

        tool = ToolRegistry.get_tool(tool_name)
        if not tool:
            return _cors(JsonResponse({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Không tìm thấy công cụ '{tool_name}'"},
            }))

        ctx = None
        if tool.requires_auth:
            try:
                ctx = resolve_user_context(request, body_params=tool_args)
            except Exception as exc:
                return _cors(JsonResponse({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32000, "message": f"Xác thực thất bại: {str(exc)}"},
                }, status=status.HTTP_401_UNAUTHORIZED))

            try:
                check_tool_permission(ctx, tool)
            except MCPPermissionDenied as exc:
                return _cors(JsonResponse({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32003, "message": exc.message},
                }))
        else:
            try:
                ctx = resolve_user_context(request, body_params=tool_args)
            except Exception:
                ctx = None

        try:
            result = tool.handler(ctx, **tool_args)
            if ctx:
                log_mcp_audit(ctx, tool, tool_args, result)
            return _cors(JsonResponse({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(result, ensure_ascii=False, indent=2),
                        }
                    ],
                    "isError": False,
                },
            }))
        except Exception as exc:
            logger.exception(f"Lỗi khi thực thi tool '{tool_name}': {exc}")
            return _cors(JsonResponse({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": f"Lỗi thực thi: {str(exc)}"}],
                    "isError": True,
                },
            }))

    # 3. tools/list: Liệt kê các tools
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

        return _cors(JsonResponse({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": available_tools},
        }))

    return _cors(JsonResponse({
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": -32601, "message": f"Method '{method}' không được hỗ trợ."},
    }))


@api_view(["GET", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
def sse_endpoint(request):
    """Server-Sent Events (SSE) stream endpoint cho remote MCP clients (Claude Desktop, Cursor, Antigravity)."""
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=status.HTTP_200_OK))

    session_id = request.query_params.get("session_id") or uuid.uuid4().hex
    host = request.get_host()
    scheme = "https" if request.is_secure() else "http"
    endpoint_url = f"{scheme}://{host}/api/mcp/messages?session_id={session_id}"

    def event_stream():
        # Sự kiện đầu tiên gửi endpoint để client gửi tiếp các message JSON-RPC
        yield f"event: endpoint\ndata: {endpoint_url}\n\n"
        yield f": keepalive {session_id}\n\n"

    response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return _cors(response)


@api_view(["POST", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
def messages_endpoint(request):
    """Điểm cuối tiếp nhận JSON-RPC messages từ MCP SSE transport."""
    return json_rpc(request)


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

