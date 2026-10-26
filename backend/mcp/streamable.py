"""Stateless MCP Streamable HTTP transport.

The legacy /api/mcp/rpc and /api/mcp/sse endpoints remain intact for
backwards compatibility. New MCP clients should use POST /api/mcp.

No sessions are issued: each request is authenticated independently, which
works with multiple Gunicorn workers without per-process session state.
"""
from __future__ import annotations

import json
import logging
import re
from urllib.parse import urlsplit

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .registry import ToolRegistry
from .security import (
    MCPPermissionDenied,
    check_tool_permission,
    log_mcp_audit,
    resolve_user_context,
)

logger = logging.getLogger(__name__)

# Supported versions of the stateless Streamable HTTP transport.
SUPPORTED_PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26")
SERVER_INFO = {"name": "FTWorkspace-MCP", "version": "1.1.0"}
ALLOW_HEADERS = (
    "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, "
    "X-AI-Key, X-API-Key"
)


def _origin_is_allowed(request):
    origin = request.headers.get("Origin")
    if not origin:
        return True
    # Exact origin matches only; do not use suffix checks that could allow
    # attacker-controlled domains like chatgpt.com.evil.example.
    try:
        parsed = urlsplit(origin)
        if not parsed.scheme or not parsed.netloc or parsed.path not in ("", "/"):
            return False
        same_origin = f"{request.scheme}://{request.get_host()}"
    except (ValueError, TypeError):
        return False
    if origin.rstrip("/") == same_origin:
        return True
    if origin in settings.CORS_ALLOWED_ORIGINS:
        return True
    return any(re.fullmatch(pattern, origin) for pattern in settings.CORS_ALLOWED_ORIGIN_REGEXES)


def _response(request, content=None, *, status=200, allow=None):
    if content is None:
        response = HttpResponse(status=status)
    else:
        response = JsonResponse(
            content, status=status, json_dumps_params={"ensure_ascii": False, "cls": DjangoJSONEncoder}
        )
    response["Cache-Control"] = "no-store"
    response["Vary"] = "Origin"
    origin = request.headers.get("Origin")
    if origin and _origin_is_allowed(request):
        response["Access-Control-Allow-Origin"] = origin
    response["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS, DELETE"
    response["Access-Control-Allow-Headers"] = ALLOW_HEADERS
    response["Access-Control-Expose-Headers"] = "MCP-Session-Id, MCP-Protocol-Version"
    if allow:
        response["Allow"] = allow
    return response


def _error(request, req_id, code, message, *, status=200):
    return _response(request, {
        "jsonrpc": "2.0", "id": req_id,
        "error": {"code": code, "message": message},
    }, status=status)


def _result(request, req_id, result):
    return _response(request, {"jsonrpc": "2.0", "id": req_id, "result": result})


def _credentials_present(request):
    """Do not silently authorize a browser session on this CSRF-exempt endpoint."""
    return bool(
        request.headers.get("Authorization")
        or request.headers.get("X-AI-Key")
        or request.headers.get("X-API-Key")
    )


def _authenticate(request, req_id):
    if not _credentials_present(request):
        response = _error(request, req_id, -32000, "Missing MCP access token", status=401)
        response["WWW-Authenticate"] = 'Bearer realm="FTWorkspace MCP"'
        return None, response
    try:
        ctx = resolve_user_context(request)
    except Exception:
        response = _error(request, req_id, -32000, "Invalid or revoked MCP access token", status=401)
        response["WWW-Authenticate"] = 'Bearer realm="FTWorkspace MCP"'
        return None, response
    return ctx, None


@csrf_exempt
def streamable_http(request):
    """MCP Streamable HTTP (stateless JSON-RPC responses).

    GET subscriptions are unsupported; per the MCP spec a stateless server
    may return HTTP 405 instead of keeping a streaming connection open.
    """
    if not _origin_is_allowed(request):
        return HttpResponse("Forbidden Origin", status=403)
    if request.method == "OPTIONS":
        return _response(request, status=204)
    if request.method in {"GET", "DELETE"}:
        return _response(request, status=405, allow="POST, OPTIONS")
    if request.method != "POST":
        return _response(request, status=405, allow="POST, OPTIONS")

    content_type = request.content_type or ""
    if content_type != "application/json":
        return _error(request, None, -32600, "Content-Type must be application/json", status=415)

    accept = request.headers.get("Accept", "*/*")
    if ("application/json" not in accept and "*/*" not in accept) or (
        "text/event-stream" not in accept and "*/*" not in accept
    ):
        return _error(
            request, None, -32600,
            "Accept must include application/json and text/event-stream", status=406,
        )

    declared_version = request.headers.get("MCP-Protocol-Version", "")
    if declared_version and declared_version not in SUPPORTED_PROTOCOL_VERSIONS:
        return _error(request, None, -32600, "Unsupported MCP-Protocol-Version", status=400)

    try:
        envelope = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return _error(request, None, -32700, "Parse error", status=400)

    if not isinstance(envelope, dict) or envelope.get("jsonrpc") != "2.0":
        return _error(request, None, -32600, "Invalid JSON-RPC request", status=400)

    method = envelope.get("method")
    req_id = envelope.get("id")
    if not isinstance(method, str) or not method:
        return _error(request, req_id, -32600, "Invalid JSON-RPC method", status=400)
    if "id" in envelope and (
        isinstance(req_id, bool) or not isinstance(req_id, (str, int, type(None)))
    ):
        return _error(request, None, -32600, "Invalid JSON-RPC id", status=400)
    params = envelope.get("params", {})
    if not isinstance(params, dict):
        return _error(request, req_id, -32602, "Invalid params", status=400)

    ctx, error_response = _authenticate(request, req_id)
    if error_response is not None:
        return error_response

    if method == "initialize":
        requested = params.get("protocolVersion")
        negotiated = requested if requested in SUPPORTED_PROTOCOL_VERSIONS else SUPPORTED_PROTOCOL_VERSIONS[0]
        return _result(request, req_id, {
            "protocolVersion": negotiated,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVER_INFO,
            "instructions": "Only tools allowed for your FTWorkspace role are exposed.",
        })

    if method.startswith("notifications/") or method == "initialized":
        return _response(request, status=202)

    # JSON-RPC responses (which have no method) are not expected; the endpoint
    # only sends synchronous responses to client requests.
    if "id" not in envelope:
        return _error(request, None, -32600, "A request id is required", status=400)

    if method == "ping":
        return _result(request, req_id, {})
    if method == "resources/list":
        return _result(request, req_id, {"resources": []})
    if method == "prompts/list":
        return _result(request, req_id, {"prompts": []})

    if method == "tools/list":
        visible = []
        for tool in ToolRegistry.list_all_tools():
            try:
                check_tool_permission(ctx, tool)
            except MCPPermissionDenied:
                continue
            visible.append(tool.to_mcp_format())
        return _result(request, req_id, {"tools": visible})

    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments", {})
        if not isinstance(name, str) or not name or not isinstance(arguments, dict):
            return _error(request, req_id, -32602, "Invalid tool name or arguments")
        tool = ToolRegistry.get_tool(name)
        if not tool:
            return _error(request, req_id, -32601, f"Unknown tool: {name}")
        try:
            check_tool_permission(ctx, tool)
        except MCPPermissionDenied as exc:
            return _error(request, req_id, -32003, exc.message, status=403)
        try:
            result = tool.handler(ctx, **arguments)
            log_mcp_audit(ctx, tool, arguments, result)
            return _result(request, req_id, {
                "content": [{
                    "type": "text",
                    "text": json.dumps(result, ensure_ascii=False, cls=DjangoJSONEncoder),
                }],
                "isError": False,
            })
        except Exception:
            logger.exception("MCP tool %s failed", name)
            return _result(request, req_id, {
                "content": [{"type": "text", "text": "FTWorkspace tool execution failed."}],
                "isError": True,
            })

    return _error(request, req_id, -32601, f"Unsupported method: {method}")
