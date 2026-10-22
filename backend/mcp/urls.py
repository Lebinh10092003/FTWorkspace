from __future__ import annotations

from django.urls import path
from . import views

urlpatterns = [
    # OpenAPI 3.1 & ChatGPT Actions
    path("mcp/openapi.json", views.openapi_spec, name="mcp_openapi_spec"),
    path("mcp/action/<str:tool_name>", views.action_invoke, name="mcp_action_invoke"),

    # Chuẩn Model Context Protocol (JSON-RPC & SSE)
    path("mcp/rpc", views.json_rpc, name="mcp_json_rpc"),
    path("mcp/sse", views.sse_endpoint, name="mcp_sse"),
    path("mcp/messages", views.messages_endpoint, name="mcp_messages"),

    # Quản lý Mã kết nối AI (AI Access Keys)
    path("mcp/keys", views.list_my_keys, name="mcp_list_my_keys"),
    path("mcp/keys/create", views.create_my_key, name="mcp_create_my_key"),
    path("mcp/keys/<str:key_id>/revoke", views.revoke_my_key, name="mcp_revoke_my_key"),
]
