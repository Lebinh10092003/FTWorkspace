from __future__ import annotations

from django.urls import path
from . import views, streamable

urlpatterns = [
    # RFC 9728: metadata OAuth cho /api/mcp (ban chinh o /.well-known/, xem mcp_oauth).
    path("mcp/.well-known/oauth-protected-resource", views.oauth_protected_resource, name="mcp_oauth_protected_resource"),

    # OpenAPI 3.1 & ChatGPT Actions
    path("mcp/openapi.json", views.openapi_spec, name="mcp_openapi_spec"),
    path("mcp/action/<str:tool_name>", views.action_invoke, name="mcp_action_invoke"),

    # Endpoint MCP chinh: Streamable HTTP (stateless, khong can session).
    # Client MCP moi (Claude Desktop, Cursor, Claude Code) nen dung URL nay.
    path("mcp", streamable.streamable_http, name="mcp_streamable"),
    path("mcp/", streamable.streamable_http, name="mcp_streamable_slash"),

    # Duong cu giu lai de cau hinh da co khong hong
    path("mcp/rpc", views.json_rpc, name="mcp_json_rpc"),
    path("mcp/sse", views.sse_endpoint, name="mcp_sse"),
    path("mcp/messages", views.messages_endpoint, name="mcp_messages"),

    # Quan ly Ma ket noi AI (AI Access Keys)
    path("mcp/keys", views.list_my_keys, name="mcp_list_my_keys"),
    path("mcp/keys/create", views.create_my_key, name="mcp_create_my_key"),
    path("mcp/keys/<str:key_id>/revoke", views.revoke_my_key, name="mcp_revoke_my_key"),
    # Ung dung AI da ket noi bang dang nhap (OAuth)
    path("mcp/oauth-connections", views.list_my_oauth_connections, name="mcp_oauth_connections"),
    path("mcp/oauth-connections/<int:grant_id>/revoke", views.revoke_my_oauth_connection, name="mcp_oauth_connection_revoke"),
]
