"""Nhập tài khoản từ Google Sheet trên máy chủ: mật khẩu không đi qua tham số hay kết quả công cụ."""
import json
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from authentication.models import UserProfile
from company_accounts import services as company_services
from company_accounts.models import CompanyAccount
from digital_training.models import TrainingPartner, TrainingPartnerAiAccount
from examination.models import LogNote

SHEET_URL = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0"


def _client(email, role, modules):
    user = User.objects.create_user(username=email, email=email, password="Password123!")
    UserProfile.objects.create(email=email, name=email.split("@")[0], role=role, access_modules=modules)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {Token.objects.create(user=user).key}")
    return client


class SheetImportToolTests(TestCase):
    def setUp(self):
        self.admin = _client("admin@fermat.vn", "ADMIN", [])
        self.staff = _client("staff@fermat.vn", "EMPLOYEE", ["digital-training"])
        self.partner = TrainingPartner.objects.create(name="THCS Thực Nghiệm")

    def call(self, client, tool, args, values, tab="Tài khoản"):
        with mock.patch("mcp.tools_sheet_import._read_sheet_values", return_value=(tab, values)):
            res = client.post(f"/api/mcp/action/{tool}", args, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        return res

    def test_ai_accounts_import_reads_passwords_from_sheet_only(self):
        values = [
            ["DANH SÁCH TÀI KHOẢN AI"],
            ["STT", "Họ và tên giáo viên", "Email", "Mật khẩu"],
            ["1", "Cô Hạnh", "van@fermat-ai.edu.vn", "PassVan#123"],
            ["2", "Thầy Minh", "anh@fermat-ai.edu.vn", ""],
            ["3", "Thiếu email", "", "x"],
        ]
        args = {"spreadsheet_url": SHEET_URL, "partner_id": self.partner.id}

        preview = self.call(self.staff, "crm_import_ai_accounts_from_sheet", {**args, "dry_run": True}, values)
        data = preview.json()["data"]
        self.assertTrue(data["dry_run"])
        self.assertEqual(data["header_row"], 2)
        self.assertEqual(data["rows_ready"], 2)
        self.assertEqual(data["missing_password_rows"], 1)
        self.assertEqual(TrainingPartnerAiAccount.objects.count(), 0)

        res = self.call(self.staff, "crm_import_ai_accounts_from_sheet", args, values)
        data = res.json()["data"]
        self.assertEqual((data["created"], data["updated"]), (2, 0))
        self.assertEqual(data["rows_skipped"][0]["row"], 5)
        van = TrainingPartnerAiAccount.objects.get(account_username="van@fermat-ai.edu.vn")
        self.assertEqual(van.account_password, "PassVan#123")
        self.assertEqual(van.assigned_to, "Cô Hạnh")
        anh = TrainingPartnerAiAccount.objects.get(account_username="anh@fermat-ai.edu.vn")
        self.assertTrue(len(anh.account_password) >= 12)  # tự sinh khi Sheet để trống
        for body in (preview.content.decode(), res.content.decode()):
            self.assertNotIn("PassVan#123", body)
            self.assertNotIn(anh.account_password, body)
        self.assertNotIn("PassVan#123", json.dumps(list(LogNote.objects.values_list("content", flat=True))))

        # Nhập lại: cập nhật, ô mật khẩu trống không đổi mật khẩu đã có
        old = anh.account_password
        again = self.call(self.staff, "crm_import_ai_accounts_from_sheet", args, values).json()["data"]
        self.assertEqual((again["created"], again["updated"]), (0, 2))
        anh.refresh_from_db()
        self.assertEqual(anh.account_password, old)

    def test_ai_accounts_import_per_row_school_and_unknown_school_skipped(self):
        values = [
            ["Trường", "Email", "Mật khẩu"],
            ["THCS Thực Nghiệm", "a@x.vn", "A#1"],
            ["Trường Không Có", "b@x.vn", "B#2"],
        ]
        data = self.call(self.staff, "crm_import_ai_accounts_from_sheet", {"spreadsheet_url": SHEET_URL}, values).json()["data"]
        self.assertEqual(data["created"], 1)
        self.assertEqual(data["rows_skipped"][0]["row"], 3)
        self.assertEqual(self.partner.ai_accounts.count() if hasattr(self.partner, "ai_accounts") else
                         TrainingPartnerAiAccount.objects.filter(partner=self.partner).count(), 1)

    def test_missing_username_column_explains_and_columns_override(self):
        values = [["Người dùng", "Hộp thư", "Khóa"], ["Cô Lan", "lan@x.vn", "L#9"]]
        args = {"spreadsheet_url": SHEET_URL, "partner_id": self.partner.id}
        bad = self.call(self.staff, "crm_import_ai_accounts_from_sheet", args, values).json()["data"]
        self.assertFalse(bad["success"])
        self.assertIn("Hộp thư", bad["error"])
        ok = self.call(self.staff, "crm_import_ai_accounts_from_sheet",
                       {**args, "columns": {"username": "Hộp thư", "password": "Khóa"}}, values).json()["data"]
        self.assertEqual(ok["created"], 1)
        self.assertEqual(TrainingPartnerAiAccount.objects.get(account_username="lan@x.vn").account_password, "L#9")

    def test_company_accounts_import_encrypts_and_never_returns_password(self):
        values = [
            ["Tên dịch vụ", "Nhà cung cấp", "Nhóm", "Email đăng nhập", "Mật khẩu", "Chi phí", "Ngày gia hạn"],
            ["ChatGPT Team", "OpenAI", "Công cụ AI", "ai@fermat.vn", "Team#Pass9", "1.250.000đ", "15/11/2026"],
            ["Canva Pro", "Canva", "design", "design@fermat.vn", "Canva#Pass1", "", ""],
            ["", "Thiếu tên", "", "x@fermat.vn", "y", "", ""],
        ]
        args = {"spreadsheet_url": SHEET_URL}
        preview = self.call(self.admin, "company_import_accounts_from_sheet", {**args, "dry_run": True}, values)
        self.assertEqual(preview.json()["data"]["rows_ready"], 2)
        self.assertEqual(CompanyAccount.objects.count(), 0)

        res = self.call(self.admin, "company_import_accounts_from_sheet", args, values)
        data = res.json()["data"]
        self.assertEqual((data["created"], data["updated"]), (2, 0))
        team = CompanyAccount.objects.get(name="ChatGPT Team")
        self.assertEqual(team.category, "ai")
        self.assertEqual(int(team.cost), 1250000)
        self.assertEqual(str(team.renewal_date), "2026-11-15")
        self.assertNotIn("Team#Pass9", team.password_encrypted)
        self.assertEqual(company_services.decrypt_password(team.password_encrypted), "Team#Pass9")
        for body in (preview.content.decode(), res.content.decode()):
            self.assertNotIn("Team#Pass9", body)
            self.assertNotIn("Canva#Pass1", body)

        again = self.call(self.admin, "company_import_accounts_from_sheet", args, values).json()["data"]
        self.assertEqual((again["created"], again["updated"]), (0, 2))

    def test_internal_accounts_import_open_to_every_employee(self):
        employee = _client("nv@fermat.vn", "EMPLOYEE", [])
        values = [["Tên dịch vụ", "Email đăng nhập", "Mật khẩu"], ["Zoom", "zoom@fermat.vn", "Zoom#1"]]
        data = self.call(employee, "company_import_accounts_from_sheet", {"spreadsheet_url": SHEET_URL}, values).json()["data"]
        self.assertEqual(data["created"], 1)

    def test_legacy_import_no_longer_echoes_passwords(self):
        res = self.staff.post("/api/mcp/action/crm_import_ai_accounts", {
            "partner_id": self.partner.id, "raw_text": "g@x.vn | Secret#Echo1 | Cô Mai",
        }, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("Secret#Echo1", res.content.decode())
        self.assertEqual(TrainingPartnerAiAccount.objects.get(account_username="g@x.vn").account_password, "Secret#Echo1")

    def test_bad_link_and_unshared_sheet_give_clear_errors(self):
        res = self.staff.post("/api/mcp/action/crm_import_ai_accounts_from_sheet",
                              {"spreadsheet_url": "khong-phai-link", "partner_id": self.partner.id}, format="json")
        self.assertIn("Link Google Sheet không hợp lệ", res.json()["data"]["error"])
        with mock.patch("mcp.tools_sheet_import._read_sheet_values", side_effect=RuntimeError("HttpError 403 PERMISSION_DENIED")):
            res = self.staff.post("/api/mcp/action/crm_import_ai_accounts_from_sheet",
                                  {"spreadsheet_url": SHEET_URL, "partner_id": self.partner.id}, format="json")
        self.assertIn("chia sẻ", res.json()["data"]["error"])
