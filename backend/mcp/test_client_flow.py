"""Mô phỏng đúng chuỗi request mà client MCP thật gửi (Claude, Cursor, mcp-remote, claude.ai)."""
import json

from django.test import TestCase
from rest_framework.test import APIClient

from authentication.models import UserProfile
from mcp.keys import create_ai_key

ACCEPT = "application/json, text/event-stream"


class MCPRealClientFlowTests(TestCase):
    def setUp(self):
        UserProfile.objects.create(email="admin@example.com", name="Admin", role="ADMIN")
        self.key = create_ai_key("admin@example.com", "Claude")["raw_key"]
        self.client = APIClient()

    def _post(self, url, body, **headers):
        return self.client.generic(
            "POST", url, json.dumps(body), content_type="application/json", HTTP_ACCEPT=ACCEPT, **headers
        )

    def _handshake(self, url, **headers):
        init = self._post(url, {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                       "clientInfo": {"name": "claude-ai", "version": "1.0"}},
        }, **headers)
        self.assertEqual(init.status_code, 200, init.content)
        self.assertTrue(init["Content-Type"].startswith("application/json"))
        self.assertEqual(init.json()["result"]["protocolVersion"], "2025-06-18")

        note = self._post(url, {"jsonrpc": "2.0", "method": "notifications/initialized"},
                          HTTP_MCP_PROTOCOL_VERSION="2025-06-18", **headers)
        self.assertEqual(note.status_code, 202)

        # Client mở luồng SSE bằng GET; máy chủ phải trả 405 (không phải 406/404) để client bỏ qua.
        stream = self.client.get(url, HTTP_ACCEPT="text/event-stream", **headers)
        self.assertEqual(stream.status_code, 405)

        tools = self._post(url, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                           HTTP_MCP_PROTOCOL_VERSION="2025-06-18", **headers)
        self.assertEqual(tools.status_code, 200)
        return [t["name"] for t in tools.json()["result"]["tools"]]

    def _whoami(self, url, **headers):
        res = self._post(url, {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                               "params": {"name": "system_whoami", "arguments": {}}}, **headers)
        self.assertEqual(res.status_code, 200)
        result = res.json()["result"]
        self.assertFalse(result["isError"], result)
        return result["content"][0]["text"]

    def test_bearer_header_flow(self):
        names = self._handshake("/api/mcp", HTTP_AUTHORIZATION=f"Bearer {self.key}")
        self.assertIn("system_whoami", names)
        self.assertGreater(len(names), 10)
        self.assertIn("admin@example.com", self._whoami("/api/mcp", HTTP_AUTHORIZATION=f"Bearer {self.key}"))

    def test_url_key_flow_for_claude_ai_and_chatgpt(self):
        url = f"/api/mcp?key={self.key}"
        names = self._handshake(url)
        self.assertIn("system_whoami", names)
        self.assertIn("admin@example.com", self._whoami(url))

    def test_trailing_slash_and_legacy_urls(self):
        for url in ("/api/mcp/", "/api/mcp/rpc", "/api/mcp/sse"):
            names = self._handshake(url, HTTP_AUTHORIZATION=f"Bearer {self.key}")
            self.assertIn("system_whoami", names, url)

    def test_without_key_is_rejected_with_401(self):
        # /api/mcp yeu cau ma ket noi ngay tu buoc initialize; client thay 401 + WWW-Authenticate.
        res = self._post("/api/mcp", {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                      "params": {"protocolVersion": "2025-06-18"}})
        self.assertEqual(res.status_code, 401)
        self.assertIn("Bearer", res["WWW-Authenticate"])

    def test_cors_preflight_from_browser_client(self):
        res = self.client.options(
            "/api/mcp", HTTP_ORIGIN="https://claude.ai",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization, content-type, mcp-protocol-version",
        )
        self.assertIn(res.status_code, (200, 204))


class MCPAccessKeyStoreTests(TestCase):
    def test_new_key_survives_concurrent_last_used_update(self):
        from unittest import mock
        from mcp import keys

        first = keys.create_ai_key("a@example.com", "Claude")["raw_key"]
        stale_store = keys._get_keys_store()  # bản đọc trước khi có mã thứ hai
        second = keys.create_ai_key("a@example.com", "Cursor")["raw_key"]
        # Lần cập nhật "lần dùng cuối" bắt đầu từ bản đọc cũ không được xóa mã vừa tạo.
        with mock.patch.object(keys, "_get_keys_store", return_value=stale_store):
            self.assertEqual(keys.verify_ai_key(first), "a@example.com")
        self.assertEqual(keys.verify_ai_key(second), "a@example.com")
        self.assertEqual(len(keys.list_ai_keys("a@example.com")), 2)

    def test_last_used_is_not_rewritten_on_every_call(self):
        from unittest import mock
        from mcp import keys

        raw = keys.create_ai_key("a@example.com")["raw_key"]
        keys.verify_ai_key(raw)
        self.assertIsNotNone(keys.list_ai_keys("a@example.com")[0]["last_used_at"])
        with mock.patch.object(keys, "_mutate_store") as mutate:
            keys.verify_ai_key(raw)
        mutate.assert_not_called()

    def test_revoked_key_and_inactive_account_are_rejected(self):
        from django.contrib.auth import get_user_model
        from mcp import keys
        from mcp.security import resolve_user_context
        from rest_framework import exceptions
        from django.test import RequestFactory

        UserProfile.objects.create(email="staff@example.com", name="Staff", role="EMPLOYEE")
        created = keys.create_ai_key("staff@example.com")
        request = RequestFactory().post("/api/mcp", HTTP_AUTHORIZATION=f"Bearer {created['raw_key']}")
        self.assertEqual(resolve_user_context(request)["email"], "staff@example.com")

        get_user_model().objects.filter(email="staff@example.com").update(is_active=False)
        with self.assertRaises(exceptions.AuthenticationFailed):
            resolve_user_context(RequestFactory().post("/api/mcp", HTTP_AUTHORIZATION=f"Bearer {created['raw_key']}"))

        get_user_model().objects.filter(email="staff@example.com").update(is_active=True)
        self.assertTrue(keys.revoke_ai_key("staff@example.com", created["id"]))
        with self.assertRaises(exceptions.AuthenticationFailed):
            resolve_user_context(RequestFactory().post("/api/mcp", HTTP_AUTHORIZATION=f"Bearer {created['raw_key']}"))
