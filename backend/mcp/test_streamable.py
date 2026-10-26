"""Transport-level tests for the stateless remote MCP endpoint."""
import json

from django.contrib.auth.models import User
from django.test import TestCase

from authentication.models import UserProfile
from mcp.keys import create_ai_key, revoke_ai_key


class StreamableHTTPTests(TestCase):
    def setUp(self):
        User.objects.create_user(
            username="mcp.staff@fermat.vn", email="mcp.staff@fermat.vn",
            password="StrongPasswordForTest123!",
        )
        UserProfile.objects.create(
            email="mcp.staff@fermat.vn",
            name="MCP test employee", role="EMPLOYEE",
            access_modules=["work-schedule"],
        )
        self.key = create_ai_key("mcp.staff@fermat.vn", "Streamable HTTP tests")
        self.headers = {
            "HTTP_AUTHORIZATION": f"Bearer {self.key['raw_key']}",
            "HTTP_ACCEPT": "application/json, text/event-stream",
            "HTTP_MCP_PROTOCOL_VERSION": "2025-11-25",
        }

    def rpc(self, method, params=None, *, headers=None, req_id=1):
        msg = {"jsonrpc": "2.0", "id": req_id, "method": method}
        if params is not None:
            msg["params"] = params
        return self.client.post(
            "/api/mcp",
            data=json.dumps(msg), content_type="application/json",
            **(self.headers if headers is None else headers),
        )

    def test_initialize_negotiates_protocol(self):
        for version in ("2025-03-26", "2025-06-18", "2025-11-25"):
            res = self.rpc(
                "initialize", {"protocolVersion": version},
                headers={**self.headers, "HTTP_MCP_PROTOCOL_VERSION": version},
            )
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["result"]["protocolVersion"], version)
            self.assertEqual(res.json()["result"]["serverInfo"]["name"], "FTWorkspace-MCP")
            self.assertNotIn("Mcp-Session-Id", res.headers)

    def test_tools_list_is_role_filtered(self):
        res = self.rpc("tools/list")
        self.assertEqual(res.status_code, 200)
        names = {tool["name"] for tool in res.json()["result"]["tools"]}
        self.assertIn("system_whoami", names)
        self.assertNotIn("finance_get_overview", names)

    def test_tool_call_uses_access_key_and_returns_content(self):
        res = self.rpc(
            "tools/call", {"name": "system_whoami", "arguments": {}},
        )
        self.assertEqual(res.status_code, 200)
        result = res.json()["result"]
        self.assertFalse(result["isError"])
        self.assertEqual(
            json.loads(result["content"][0]["text"])["email"], "mcp.staff@fermat.vn",
        )

    def test_unauthenticated_and_revoked_key_rejected(self):
        headers = {"HTTP_ACCEPT": "application/json, text/event-stream"}
        self.assertEqual(self.rpc("tools/list", headers=headers).status_code, 401)
        revoke_ai_key("mcp.staff@fermat.vn", self.key["id"])
        self.assertEqual(self.rpc("tools/list").status_code, 401)

    def test_forbidden_tools_return_403(self):
        res = self.rpc("tools/call", {"name": "finance_get_overview", "arguments": {}})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["error"]["code"], -32003)

    def test_notification_is_accepted_without_response(self):
        response = self.client.post(
            "/api/mcp",
            data=json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            content_type="application/json", **self.headers,
        )
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.content, b"")

    def test_stateless_get_and_delete_return_405(self):
        for method in ("get", "delete"):
            response = getattr(self.client, method)("/api/mcp", **self.headers)
            self.assertEqual(response.status_code, 405)

    def test_options_and_cors_origin(self):
        response = self.client.options(
            "/api/mcp", HTTP_ORIGIN="https://chatgpt.com",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response["Access-Control-Allow-Origin"], "https://chatgpt.com")
        self.assertEqual(
            self.rpc("ping", headers={**self.headers, "HTTP_ORIGIN": "https://attacker.example"}).status_code,
            403,
        )

    def test_rejects_unsupported_protocol_version(self):
        res = self.rpc(
            "initialize", {"protocolVersion": "2025-11-25"},
            headers={**self.headers, "HTTP_MCP_PROTOCOL_VERSION": "2099-01-01"},
        )
        self.assertEqual(res.status_code, 400)

    def test_rejects_invalid_json_rpc(self):
        response = self.client.post(
            "/api/mcp", data="[1, 2]", content_type="application/json", **self.headers,
        )
        self.assertEqual(response.status_code, 400)

    def test_key_is_not_echoed(self):
        res = self.rpc("tools/list")
        self.assertNotIn(self.key["raw_key"], res.content.decode("utf-8"))
