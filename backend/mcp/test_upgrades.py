"""Bảo mật và công cụ mới của MCP: che mật khẩu, chú thích tool, khách hàng, tài khoản công ty."""
import json

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from authentication.models import UserProfile
from company_accounts.models import CompanyAccount, CompanyAccountLog
from digital_training.models import TrainingLead, TrainingPartner, TrainingPartnerAiAccount
from examination.models import LogNote
from mcp.keys import create_ai_key


def _client(email, role, modules):
    user = User.objects.create_user(username=email, email=email, password="Password123!")
    UserProfile.objects.create(email=email, name=email.split("@")[0], role=role, access_modules=modules)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {Token.objects.create(user=user).key}")
    return client


class MCPUpgradeTests(TestCase):
    def setUp(self):
        self.admin = _client("admin@fermat.vn", "ADMIN", [])
        self.manager = _client("manager@fermat.vn", "MANAGER", ["digital-training"])
        self.staff = _client("staff@fermat.vn", "EMPLOYEE", ["digital-training"])
        self.partner = TrainingPartner.objects.create(name="THCS Thực Nghiệm", phone="0912345678")
        TrainingPartner.objects.create(name="THPT Chu Văn An")
        TrainingPartner.objects.create(name="THPT Chu Văn An Hà Đông")

    def call(self, client, tool, args=None):
        return client.post(f"/api/mcp/action/{tool}", args or {}, format="json")

    # ---------------------------------------------------------------- bảo mật
    def test_ai_account_api_is_not_public(self):
        TrainingPartnerAiAccount.objects.create(partner=self.partner, account_username="a@x.vn", account_password="P@ss")
        res = APIClient().get("/api/digital-training/ai-accounts")
        self.assertIn(res.status_code, (401, 403))
        self.assertEqual(self.staff.get("/api/digital-training/ai-accounts").status_code, 200)

    def test_audit_log_never_stores_passwords(self):
        res = self.call(self.staff, "crm_create_ai_account", {
            "partner_id": self.partner.id, "account_username": "gv@x.vn", "account_password": "VerySecret#123",
        })
        self.assertTrue(res.json()["success"])
        notes = " ".join(LogNote.objects.filter(entity_key="mcp-digital-training").values_list("content", flat=True))
        self.assertIn("gv@x.vn", notes)
        self.assertNotIn("VerySecret#123", notes)

    def test_ai_account_list_masks_passwords_unless_asked(self):
        TrainingPartnerAiAccount.objects.create(partner=self.partner, account_username="a@x.vn", account_password="Hidden#Pass")
        masked = self.call(self.staff, "crm_list_ai_accounts", {"partner_id": self.partner.id}).json()["data"]
        self.assertTrue(masked["passwords_hidden"])
        self.assertNotIn("Hidden#Pass", json.dumps(masked))

        shown = self.call(self.staff, "crm_list_ai_accounts", {"partner_id": self.partner.id, "show_passwords": True}).json()["data"]
        self.assertEqual(shown["accounts"][0]["account_password"], "Hidden#Pass")
        self.assertTrue(LogNote.objects.filter(key__startswith="mcp:ai-account-secret:").exists())

    def test_tools_carry_mcp_annotations(self):
        key = create_ai_key("admin@fermat.vn", "test")
        res = self.client.post(
            "/api/mcp", data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {key['raw_key']}", HTTP_ACCEPT="application/json, text/event-stream",
            HTTP_MCP_PROTOCOL_VERSION="2025-06-18",
        )
        tools = {t["name"]: t for t in res.json()["result"]["tools"]}
        self.assertTrue(tools["crm_search_customers"]["annotations"]["readOnlyHint"])
        self.assertFalse(tools["crm_create_lead"]["annotations"]["readOnlyHint"])
        self.assertFalse(tools["crm_create_lead"]["annotations"]["destructiveHint"])
        self.assertTrue(tools["crm_delete_ai_account"]["annotations"]["destructiveHint"])
        self.assertTrue(tools["company_delete_account"]["annotations"]["destructiveHint"])
        self.assertEqual(tools["company_list_accounts"]["title"], "Danh sách tài khoản nội bộ")

    # ---------------------------------------------------------------- khách hàng
    def test_update_customer_requires_manager_and_appends_note(self):
        self.assertEqual(self.call(self.staff, "crm_update_customer", {"partner_id": self.partner.id, "phone": "0999"}).status_code, 403)

        self.partner.notes = "Ghi chú cũ"
        self.partner.save()
        body = self.call(self.manager, "crm_update_customer", {
            "partner_id": self.partner.id, "phone": "0987654321", "email": "",
            "add_contact": {"contact_person": "Cô Lan", "phone": "0911"}, "append_note": "Hẹn demo AI tuần sau",
        }).json()["data"]
        self.assertTrue(body["success"], body)
        self.partner.refresh_from_db()
        self.assertEqual(self.partner.phone, "0987654321")
        self.assertTrue(self.partner.notes.startswith("Ghi chú cũ\n["))
        self.assertIn("Hẹn demo AI tuần sau", self.partner.notes)
        self.assertEqual(self.partner.additional_contacts[0]["contact_person"], "Cô Lan")

    def test_update_customer_refuses_ambiguous_name(self):
        body = self.call(self.manager, "crm_update_customer", {"partner_name": "Chu Văn An", "phone": "0999"}).json()["data"]
        self.assertFalse(body["success"])
        self.assertIn("nhiều khách hàng", body["error"])

    def test_pipeline_overview(self):
        TrainingLead.objects.create(name="THCS A", stage="proposal")
        TrainingLead.objects.create(name="THCS B", stage="lost")
        data = self.call(self.staff, "crm_pipeline_overview").json()["data"]
        self.assertEqual(data["partners_total"], 3)
        self.assertEqual(data["leads_total"], 1)
        self.assertEqual(data["leads_by_stage"]["proposal"]["count"], 1)

    # ---------------------------------------------------------------- tài khoản công ty
    def test_internal_account_tools_open_to_employees_delete_admin_only(self):
        self.assertEqual(self.call(self.staff, "company_list_accounts").status_code, 200)
        created = self.call(self.staff, "company_create_account", {"name": "Zoom", "username": "zoom@fermat.vn"}).json()["data"]
        self.assertTrue(created["success"], created)
        denied = self.call(self.staff, "company_delete_account", {"account_id": created["account"]["id"], "confirm": True})
        self.assertEqual(denied.status_code, 403)

    def test_company_account_tools_flow(self):
        created = self.call(self.admin, "company_create_account", {
            "name": "ChatGPT Team", "category": "ai", "username": "ai@fermat.vn", "password": "Team#Pass9",
            "cost": 1500000, "billing_cycle": "monthly",
        }).json()["data"]
        self.assertTrue(created["success"], created)
        account_id = created["account"]["id"]
        self.assertNotIn("Team#Pass9", json.dumps(created))

        listed = self.call(self.admin, "company_list_accounts", {"query": "chatgpt"}).json()["data"]
        self.assertEqual(listed["count"], 1)
        self.assertNotIn("password", listed["accounts"][0])

        revealed = self.call(self.admin, "company_get_account_password", {"account_id": account_id, "reason": "Đăng nhập gia hạn"}).json()["data"]
        self.assertEqual(revealed["password"], "Team#Pass9")
        log = CompanyAccountLog.objects.get(action="reveal")
        self.assertEqual((log.channel, log.detail), ("mcp", "Đăng nhập gia hạn"))

        all_notes = " ".join(LogNote.objects.values_list("content", flat=True))
        self.assertNotIn("Team#Pass9", all_notes)

        updated = self.call(self.admin, "company_update_account", {"account_id": account_id, "status": "suspended"}).json()["data"]
        self.assertEqual(updated["account"]["status"], "suspended")

        refused = self.call(self.admin, "company_delete_account", {"account_id": account_id, "confirm": False}).json()["data"]
        self.assertFalse(refused["success"])
        self.assertTrue(CompanyAccount.objects.filter(pk=account_id).exists())
        done = self.call(self.admin, "company_delete_account", {"account_id": account_id, "confirm": True}).json()["data"]
        self.assertTrue(done["success"])
        self.assertFalse(CompanyAccount.objects.filter(pk=account_id).exists())


class MCPLogicFixTests(TestCase):
    """Công cụ ghi dữ liệu không được đoán khách hàng; trạng thái dịch vụ khớp với web."""

    def setUp(self):
        from digital_training.models import TrainingProduct, TrainingProductSubscription
        self.staff = _client("logic@fermat.vn", "EMPLOYEE", ["digital-training"])
        self.a = TrainingPartner.objects.create(name="THPT Chu Văn An")
        self.b = TrainingPartner.objects.create(name="THPT Chu Văn An Hà Đông")
        self.bndc, _ = TrainingProduct.objects.get_or_create(code="bndc", defaults={"name": "BNDC test"})
        self.ai, _ = TrainingProduct.objects.get_or_create(code="ai-dung-chung", defaults={"name": "AI test"})
        self.Sub = TrainingProductSubscription

    def call(self, tool, args):
        return self.staff.post(f"/api/mcp/action/{tool}", args, format="json").json()["data"]

    def test_write_tools_refuse_ambiguous_partner_name(self):
        body = self.call("crm_create_ai_account", {"partner_name": "Chu Văn An Hà", "account_username": "x@y.vn"})
        self.assertTrue(body["success"])
        self.assertEqual(TrainingPartnerAiAccount.objects.get().partner, self.b)

        body = self.call("crm_create_ai_account", {"partner_name": "Chu Văn", "account_username": "z@y.vn"})
        self.assertFalse(body["success"])
        self.assertIn("nhiều khách hàng", body["error"])

        # Tên trùng khớp chính xác vẫn được chọn dù có tên dài hơn chứa nó.
        body = self.call("crm_create_ai_account", {"partner_name": "THPT Chu Văn An", "account_username": "w@y.vn"})
        self.assertTrue(body["success"])
        self.assertEqual(TrainingPartnerAiAccount.objects.get(account_username="w@y.vn").partner, self.a)

    def test_renew_refuses_when_partner_has_several_products(self):
        import datetime
        today = datetime.date.today()
        self.Sub.objects.create(partner=self.a, product=self.bndc, expires_at=today)
        self.Sub.objects.create(partner=self.a, product=self.ai, expires_at=today)
        body = self.call("crm_renew_subscription", {"partner_name": "THPT Chu Văn An", "months_to_add": 12})
        self.assertFalse(body["success"])
        self.assertIn("nhiều gói", body["error"])
        self.assertFalse(self.Sub.objects.filter(expires_at__gt=today).exists())

    def test_contract_only_expiry_counts_as_expiring(self):
        import datetime
        soon = datetime.date.today() + datetime.timedelta(days=5)
        self.Sub.objects.create(partner=self.a, product=self.bndc, contract_expires_at=soon)
        expiring = self.call("crm_get_expiring_products", {"days_ahead": 30})
        self.assertEqual(expiring["total"], 1)
        listed = self.call("crm_list_subscriptions", {"status_filter": "expiring"})
        self.assertEqual(listed["count"], 1)
        self.assertEqual(listed["subscriptions"][0]["expires_at"], soon.isoformat())
        overview = self.call("crm_pipeline_overview", {})
        self.assertEqual(overview["subscriptions_expiring_count"], 1)

    def test_status_filter_is_applied_before_the_100_row_limit(self):
        import datetime
        far = datetime.date.today() + datetime.timedelta(days=400)
        for i in range(105):
            partner = TrainingPartner.objects.create(name=f"A{i:03d} Trường")
            self.Sub.objects.create(partner=partner, product=self.bndc, expires_at=far)
        late = TrainingPartner.objects.create(name="Z Trường cuối danh sách")
        self.Sub.objects.create(partner=late, product=self.bndc, expires_at=datetime.date.today() - datetime.timedelta(days=1))
        listed = self.call("crm_list_subscriptions", {"status_filter": "expired"})
        self.assertEqual(listed["count"], 1)
        self.assertEqual(listed["subscriptions"][0]["partner_name"], "Z Trường cuối danh sách")

    def test_moving_ai_account_recounts_both_partners(self):
        account = TrainingPartnerAiAccount.objects.create(partner=self.a, account_username="m@y.vn", account_password="x")
        self.a.refresh_ai_account_count()
        res = self.staff.patch(f"/api/digital-training/ai-accounts/{account.id}", {"partner": self.b.id}, format="json")
        self.assertEqual(res.status_code, 200)
        self.a.refresh_from_db()
        self.b.refresh_from_db()
        self.assertEqual((self.a.ai_account_count, self.b.ai_account_count), (0, 1))
