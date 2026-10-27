"""Luồng OAuth MCP như ChatGPT/Claude: chỉ dán https://.../mcp, đăng nhập web là xong."""
import base64
import hashlib
import json
import secrets
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token

from authentication.models import UserProfile

from .models import OAuthGrant

REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect"
MCP_HEADERS = {"HTTP_ACCEPT": "application/json, text/event-stream"}


def pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


class OAuthFlowTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("staff@fermat.vn", "staff@fermat.vn", "Matkhau#123")
        UserProfile.objects.get_or_create(email="staff@fermat.vn", defaults={"name": "Nhân viên", "role": "EMPLOYEE"})

    # ---- helpers ----
    def register(self, **extra):
        body = {"client_name": "ChatGPT", "redirect_uris": [REDIRECT], **extra}
        res = self.client.post("/api/oauth/register", json.dumps(body), content_type="application/json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.json()

    def authorize_params(self, client_id, challenge, redirect=REDIRECT):
        return {"response_type": "code", "client_id": client_id, "redirect_uri": redirect, "state": "xyz",
                "code_challenge": challenge, "code_challenge_method": "S256", "scope": "mcp",
                "resource": "http://testserver/mcp"}

    def login_and_get_code(self, client_id, challenge, **post):
        page = self.client.get("/api/oauth/authorize", self.authorize_params(client_id, challenge))
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, "ChatGPT")
        blob = page.context["blob"]
        data = {"request": blob, "action": "allow", **(post or {"email": "staff@fermat.vn", "password": "Matkhau#123"})}
        res = self.client.post("/api/oauth/authorize", data)
        self.assertEqual(res.status_code, 302, getattr(res, "content", b"")[:300])
        query = parse_qs(urlsplit(res["Location"]).query)
        self.assertTrue(res["Location"].startswith(REDIRECT))
        self.assertEqual(query["state"], ["xyz"])
        return query["code"][0]

    def exchange(self, client_id, code, verifier):
        return self.client.post("/api/oauth/token", {
            "grant_type": "authorization_code", "client_id": client_id, "code": code,
            "redirect_uri": REDIRECT, "code_verifier": verifier,
        })

    def call_mcp(self, token, path="/mcp"):
        return self.client.post(path, json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                                  "params": {"name": "system_whoami", "arguments": {}}}),
                                content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {token}", **MCP_HEADERS)

    # ---- tests ----
    def test_discovery_from_401(self):
        res = self.client.post("/mcp", json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}),
                               content_type="application/json", **MCP_HEADERS)
        self.assertEqual(res.status_code, 401)
        self.assertIn('resource_metadata="http://testserver/.well-known/oauth-protected-resource/mcp"',
                      res["WWW-Authenticate"])

        prm = self.client.get("/.well-known/oauth-protected-resource/mcp").json()
        self.assertEqual(prm["resource"], "http://testserver/mcp")
        self.assertEqual(prm["authorization_servers"], ["http://testserver"])
        self.assertEqual(self.client.get("/.well-known/oauth-protected-resource").status_code, 200)

        asm = self.client.get("/.well-known/oauth-authorization-server").json()
        self.assertEqual(asm["issuer"], "http://testserver")
        self.assertEqual(asm["code_challenge_methods_supported"], ["S256"])
        self.assertTrue(asm["registration_endpoint"].endswith("/api/oauth/register"))

    def test_full_flow_password_login(self):
        client_id = self.register()["client_id"]
        verifier, challenge = pkce()
        code = self.login_and_get_code(client_id, challenge)
        res = self.exchange(client_id, code, verifier)
        self.assertEqual(res.status_code, 200, res.content)
        tokens = res.json()
        self.assertTrue(tokens["access_token"].startswith("ft_oat_"))
        self.assertEqual(tokens["token_type"], "Bearer")

        whoami = self.call_mcp(tokens["access_token"])
        self.assertEqual(whoami.status_code, 200, whoami.content)
        self.assertIn("staff@fermat.vn", whoami.content.decode())
        self.assertEqual(self.call_mcp(tokens["access_token"], "/api/mcp").status_code, 200)

        # Mã ủy quyền chỉ dùng một lần; dùng lại thì thu hồi luôn kết nối.
        self.assertEqual(self.exchange(client_id, code, verifier).status_code, 400)
        self.assertEqual(self.call_mcp(tokens["access_token"]).status_code, 401)

    def test_refresh_rotates_and_revoke(self):
        client_id = self.register()["client_id"]
        verifier, challenge = pkce()
        tokens = self.exchange(client_id, self.login_and_get_code(client_id, challenge), verifier).json()
        res = self.client.post("/api/oauth/token", {"grant_type": "refresh_token", "client_id": client_id,
                                                    "refresh_token": tokens["refresh_token"]})
        self.assertEqual(res.status_code, 200)
        new = res.json()
        self.assertEqual(self.call_mcp(tokens["access_token"]).status_code, 401)  # token cũ hết dùng
        self.assertEqual(self.call_mcp(new["access_token"]).status_code, 200)
        old_refresh = self.client.post("/api/oauth/token", {"grant_type": "refresh_token", "client_id": client_id,
                                                            "refresh_token": tokens["refresh_token"]})
        self.assertEqual(old_refresh.status_code, 400)

        self.client.post("/api/oauth/revoke", {"client_id": client_id, "token": new["refresh_token"]})
        self.assertEqual(self.call_mcp(new["access_token"]).status_code, 401)

    def test_expired_access_token_rejected(self):
        client_id = self.register()["client_id"]
        verifier, challenge = pkce()
        tokens = self.exchange(client_id, self.login_and_get_code(client_id, challenge), verifier).json()
        OAuthGrant.objects.update(access_expires_at=timezone.now() - timedelta(seconds=1))
        res = self.call_mcp(tokens["access_token"])
        self.assertEqual(res.status_code, 401)
        self.assertIn('error="invalid_token"', res["WWW-Authenticate"])

    def test_wrong_pkce_and_wrong_password(self):
        client_id = self.register()["client_id"]
        verifier, challenge = pkce()
        page = self.client.get("/api/oauth/authorize", self.authorize_params(client_id, challenge))
        bad = self.client.post("/api/oauth/authorize", {"request": page.context["blob"], "action": "allow",
                                                        "email": "staff@fermat.vn", "password": "sai"})
        self.assertEqual(bad.status_code, 400)
        self.assertContains(bad, "không chính xác", status_code=400)

        code = self.login_and_get_code(client_id, challenge)
        self.assertEqual(self.exchange(client_id, code, pkce()[0]).json()["error"], "invalid_grant")

    def test_existing_web_session_can_approve(self):
        client_id = self.register()["client_id"]
        verifier, challenge = pkce()
        web_token = Token.objects.create(user=self.user).key
        code = self.login_and_get_code(client_id, challenge, web_token=web_token)
        self.assertEqual(self.exchange(client_id, code, verifier).status_code, 200)

    def test_deny_redirects_with_access_denied(self):
        client_id = self.register()["client_id"]
        page = self.client.get("/api/oauth/authorize", self.authorize_params(client_id, pkce()[1]))
        res = self.client.post("/api/oauth/authorize", {"request": page.context["blob"], "action": "deny"})
        self.assertIn("error=access_denied", res["Location"])

    def test_unregistered_redirect_is_not_followed(self):
        client_id = self.register()["client_id"]
        res = self.client.get("/api/oauth/authorize",
                              self.authorize_params(client_id, pkce()[1], redirect="https://evil.example/cb"))
        self.assertEqual(res.status_code, 400)
        self.assertNotIn("Location", res)

    def test_missing_pkce_rejected(self):
        client_id = self.register()["client_id"]
        params = self.authorize_params(client_id, "")
        res = self.client.get("/api/oauth/authorize", params)
        self.assertIn("error=invalid_request", res["Location"])

    def test_confidential_client_needs_secret(self):
        reg = self.register(token_endpoint_auth_method="client_secret_post")
        verifier, challenge = pkce()
        code = self.login_and_get_code(reg["client_id"], challenge)
        self.assertEqual(self.exchange(reg["client_id"], code, verifier).status_code, 401)
        verifier, challenge = pkce()
        code = self.login_and_get_code(reg["client_id"], challenge)
        res = self.client.post("/api/oauth/token", {
            "grant_type": "authorization_code", "client_id": reg["client_id"], "client_secret": reg["client_secret"],
            "code": code, "redirect_uri": REDIRECT, "code_verifier": verifier})
        self.assertEqual(res.status_code, 200)

    def test_register_rejects_bad_redirects(self):
        for uri in ("http://evil.example/cb", "javascript:alert(1)", "https://a.example/cb#frag"):
            res = self.client.post("/api/oauth/register", json.dumps({"redirect_uris": [uri]}),
                                   content_type="application/json")
            self.assertEqual(res.status_code, 400, uri)

    def test_loopback_redirect_any_port(self):
        reg = self.client.post("/api/oauth/register", json.dumps({
            "client_name": "Claude Code", "redirect_uris": ["http://localhost:3118/callback"]}),
            content_type="application/json").json()
        res = self.client.get("/api/oauth/authorize", {
            "response_type": "code", "client_id": reg["client_id"], "redirect_uri": "http://localhost:50123/callback",
            "code_challenge": pkce()[1], "code_challenge_method": "S256"})
        self.assertEqual(res.status_code, 200)

    def test_connections_list_and_revoke(self):
        client_id = self.register()["client_id"]
        verifier, challenge = pkce()
        tokens = self.exchange(client_id, self.login_and_get_code(client_id, challenge), verifier).json()
        web = Token.objects.create(user=self.user).key
        listing = self.client.get("/api/mcp/oauth-connections", HTTP_AUTHORIZATION=f"Bearer {web}").json()
        self.assertEqual(len(listing["connections"]), 1)
        self.assertEqual(listing["connections"][0]["client"], "ChatGPT")
        grant_id = listing["connections"][0]["id"]
        res = self.client.post(f"/api/mcp/oauth-connections/{grant_id}/revoke", HTTP_AUTHORIZATION=f"Bearer {web}")
        self.assertTrue(res.json()["success"])
        self.assertEqual(self.call_mcp(tokens["access_token"]).status_code, 401)

    def test_inactive_user_token_stops_working(self):
        client_id = self.register()["client_id"]
        verifier, challenge = pkce()
        tokens = self.exchange(client_id, self.login_and_get_code(client_id, challenge), verifier).json()
        User.objects.filter(pk=self.user.pk).update(is_active=False)
        self.assertEqual(self.call_mcp(tokens["access_token"]).status_code, 401)
