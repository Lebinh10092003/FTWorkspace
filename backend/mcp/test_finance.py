"""Công cụ MCP Báo cáo thu chi: doanh thu ghi vào sổ thu chi, phân mảng Khảo thí / CNS&ĐT."""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from authentication.models import UserProfile
from digital_training.finance_division import classify_division, looks_like_finance_record
from digital_training.models import TrainingFinanceEntry, TrainingPartner


def _client(email, role, modules):
    user = User.objects.create_user(username=email, email=email, password="Password123!")
    UserProfile.objects.create(email=email, name=email.split("@")[0], role=role, access_modules=modules)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {Token.objects.create(user=user).key}")
    return client


class FinanceDivisionRuleTests(TestCase):
    def test_classify_by_competition_and_training_keywords(self):
        self.assertEqual(classify_division("Lệ phí thi FIMO trường THCS A")[0], "examination")
        self.assertEqual(classify_division("Thu tiền coi thi vòng loại")[0], "examination")
        self.assertEqual(classify_division("Doanh thu bản quyền BNDC năm 2026")[0], "digital_training")
        self.assertEqual(classify_division("Học phí khóa đào tạo giáo viên")[0], "digital_training")
        self.assertIsNone(classify_division("Doanh thu tháng 10")[0])
        self.assertIsNone(classify_division("Hợp đồng tổ chức cuộc thi FIMO")[0])

    def test_finance_note_detection(self):
        self.assertTrue(looks_like_finance_record("Doanh thu 25.000.000đ hợp đồng BNDC"))
        self.assertTrue(looks_like_finance_record("Đã thu 15tr chuyển khoản"))
        self.assertFalse(looks_like_finance_record("Gặp thầy hiệu trưởng, hẹn tuần sau"))
        self.assertFalse(looks_like_finance_record("Trường có 1200 học sinh"))


class FinanceToolTests(TestCase):
    def setUp(self):
        self.admin = _client("admin.finance@fermat.vn", "ADMIN", [])
        self.partner = TrainingPartner.objects.create(name="THCS Thử Nghiệm")

    def call(self, tool, args, client=None):
        response = (client or self.admin).post(f"/api/mcp/action/{tool}", args, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["data"]

    def test_revenue_goes_to_finance_ledger_with_explicit_division(self):
        data = self.call("finance_create_entry", {
            "entry_type": "income", "division": "digital_training", "category": "Doanh thu hợp đồng",
            "description": "Doanh thu hợp đồng năm học 2026-2027", "amount": 25000000,
            "partner_name": "THCS Thử Nghiệm",
        })
        self.assertTrue(data["success"], data)
        entry = TrainingFinanceEntry.objects.get()
        self.assertEqual((entry.division, entry.partner_id, int(entry.amount)), ("digital_training", self.partner.id, 25000000))
        self.partner.refresh_from_db()
        self.assertEqual(self.partner.notes, "")

    def test_unclear_division_asks_user_and_writes_nothing(self):
        data = self.call("finance_create_entry", {
            "entry_type": "income", "category": "Doanh thu", "description": "Doanh thu tháng 10", "amount": 5000000,
        })
        self.assertFalse(data["success"])
        self.assertEqual(data["needs_user_input"], "division")
        self.assertIn("Khảo thí", data["question"])
        self.assertFalse(TrainingFinanceEntry.objects.exists())

    def test_clear_content_picks_division_automatically(self):
        data = self.call("finance_create_entry", {
            "entry_type": "income", "category": "Lệ phí thi", "description": "Lệ phí thi FIMO trường A", "amount": 2500000,
        })
        self.assertTrue(data["success"], data)
        self.assertEqual(TrainingFinanceEntry.objects.get().division, "examination")

    def test_conflicting_division_needs_confirmation(self):
        args = {
            "entry_type": "income", "division": "digital_training", "category": "Lệ phí thi",
            "description": "Lệ phí thi FIEO", "amount": 1000000,
        }
        data = self.call("finance_create_entry", args)
        self.assertEqual((data["needs_user_input"], data["suggested_division"]), ("division", "examination"))
        self.assertFalse(TrainingFinanceEntry.objects.exists())
        data = self.call("finance_create_entry", {**args, "division_confirmed": True})
        self.assertTrue(data["success"])
        self.assertEqual(TrainingFinanceEntry.objects.get().division, "digital_training")

    def test_overview_and_list_split_by_division(self):
        for division, amount in (("examination", 3000000), ("digital_training", 7000000)):
            TrainingFinanceEntry.objects.create(
                transaction_date="2026-10-01", entry_type="income", division=division, category="Thu",
                description="x", amount=amount, status="completed",
            )
        overview = self.call("finance_get_overview", {})
        self.assertEqual(overview["completed"]["total_income"], 10000000)
        self.assertEqual(overview["by_division"]["examination"]["total_income"], 3000000)
        listed = self.call("finance_list_entries", {"division": "examination"})
        self.assertEqual(listed["count"], 1)

    def test_update_and_delete_entry(self):
        entry = TrainingFinanceEntry.objects.create(
            transaction_date="2026-10-01", entry_type="income", division="digital_training", category="Thu",
            description="x", amount=1000, status="pending",
        )
        data = self.call("finance_update_entry", {"entry_id": entry.id, "status": "completed", "division": "examination"})
        self.assertTrue(data["success"], data)
        entry.refresh_from_db()
        self.assertEqual((entry.status, entry.division), ("completed", "examination"))
        data = self.call("finance_delete_entry", {"entry_id": entry.id})
        self.assertEqual(data["needs_user_input"], "confirm")
        self.assertTrue(TrainingFinanceEntry.objects.filter(pk=entry.id).exists())
        self.assertTrue(self.call("finance_delete_entry", {"entry_id": entry.id, "confirm": True})["success"])
        self.assertFalse(TrainingFinanceEntry.objects.filter(pk=entry.id).exists())

    def test_customer_note_rejects_revenue(self):
        data = self.call("crm_update_customer", {
            "partner_id": self.partner.id, "append_note": "Doanh thu 25.000.000đ hợp đồng năm 2026",
        })
        self.assertFalse(data["success"])
        self.assertEqual(data["use_tool"], "finance_create_entry")
        self.partner.refresh_from_db()
        self.assertEqual(self.partner.notes, "")
        ok = self.call("crm_update_customer", {"partner_id": self.partner.id, "append_note": "Hẹn gặp tuần sau"})
        self.assertTrue(ok["success"], ok)

    def test_web_api_requires_division_and_filters(self):
        payload = {"transaction_date": "2026-10-02", "entry_type": "income", "category": "Thu",
                   "description": "Thu", "amount": 1000}
        response = self.admin.post("/api/digital-training/finance-entries", payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("division", response.json())
        response = self.admin.post("/api/digital-training/finance-entries", {**payload, "division": "examination"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["division_label"], "Khảo thí")
        rows = self.admin.get("/api/digital-training/finance-entries?division=digital_training").json()
        self.assertEqual(rows, [])
