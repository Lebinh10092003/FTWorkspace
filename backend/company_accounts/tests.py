import datetime

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from authentication.models import UserProfile

from .models import CompanyAccount, CompanyAccountLog


def _user(email, role, modules=None):
    user = User.objects.create_user(username=email, email=email, password="Password123!")
    UserProfile.objects.create(email=email, name=email.split("@")[0], role=role, access_modules=modules or [])
    return Token.objects.create(user=user)


class CompanyAccountApiTests(TestCase):
    def setUp(self):
        self.admin = APIClient()
        self.admin.credentials(HTTP_AUTHORIZATION=f"Bearer {_user('boss@fermat.vn', 'ADMIN').key}")
        self.staff = APIClient()
        self.staff.credentials(HTTP_AUTHORIZATION=f"Bearer {_user('staff@fermat.vn', 'MANAGER', ['digital-training']).key}")

    def _create(self, **extra):
        payload = {
            "name": "Google Workspace – admin",
            "category": "email",
            "provider": "Google",
            "loginUrl": "admin.google.com",
            "username": "admin@fermat.vn",
            "password": "S3cret-Pass!",
            "ownerEmail": "boss@fermat.vn",
            "cost": "1.200.000".replace(".", ""),
            "billingCycle": "yearly",
            "renewalDate": (timezone.localdate() + datetime.timedelta(days=10)).isoformat(),
            **extra,
        }
        return self.admin.post("/api/company-accounts", payload, format="json")

    def test_password_is_encrypted_and_never_listed(self):
        res = self._create()
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertNotIn("password", body)
        self.assertTrue(body["hasPassword"])
        self.assertEqual(body["loginUrl"], "https://admin.google.com")

        stored = CompanyAccount.objects.get(pk=body["id"])
        self.assertTrue(stored.password_encrypted)
        self.assertNotIn("S3cret-Pass!", stored.password_encrypted)

        listing = self.admin.get("/api/company-accounts").json()
        self.assertEqual(len(listing), 1)
        self.assertNotIn("S3cret-Pass!", str(listing))

    def test_reveal_returns_password_and_is_logged(self):
        account_id = self._create().json()["id"]
        res = self.admin.post(f"/api/company-accounts/{account_id}/reveal")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["password"], "S3cret-Pass!")
        self.assertEqual(res["Cache-Control"], "no-store")
        self.assertTrue(CompanyAccountLog.objects.filter(account_id=account_id, action="reveal", actor_email="boss@fermat.vn").exists())

    def test_only_admin_can_use_api(self):
        account_id = self._create().json()["id"]
        self.assertEqual(self.staff.get("/api/company-accounts").status_code, 403)
        self.assertEqual(self.staff.post(f"/api/company-accounts/{account_id}/reveal").status_code, 403)
        self.assertEqual(APIClient().get("/api/company-accounts").status_code in (401, 403), True)

    def test_patch_keeps_password_unless_changed_or_cleared(self):
        account_id = self._create().json()["id"]
        self.admin.patch(f"/api/company-accounts/{account_id}", {"plan": "Business Plus"}, format="json")
        self.assertEqual(self.admin.post(f"/api/company-accounts/{account_id}/reveal").json()["password"], "S3cret-Pass!")

        self.admin.patch(f"/api/company-accounts/{account_id}", {"password": "NewPass#2"}, format="json")
        self.assertEqual(self.admin.post(f"/api/company-accounts/{account_id}/reveal").json()["password"], "NewPass#2")
        self.assertTrue(CompanyAccountLog.objects.filter(account_id=account_id, action="password").exists())

        res = self.admin.patch(f"/api/company-accounts/{account_id}", {"clearPassword": True}, format="json")
        self.assertFalse(res.json()["hasPassword"])

    def test_validation_errors(self):
        res = self._create(ownerEmail="not-an-email", cost="abc", renewalDate="31/12/2026")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(set(res.json()["errors"]), {"owner_email", "cost", "renewal_date"})
        self.assertEqual(CompanyAccount.objects.count(), 0)

    def test_summary_counts_monthly_cost_and_renewals(self):
        self._create()  # 1.200.000 / năm → 100.000 / tháng, gia hạn sau 10 ngày
        self._create(name="Canva Pro", category="design", cost="300000", billingCycle="monthly", renewalDate="", password="")
        self._create(name="Cũ", status="cancelled", cost="999999", billingCycle="monthly")
        data = self.admin.get("/api/company-accounts/summary").json()
        self.assertEqual(data["active"], 2)
        self.assertEqual(data["monthlyCost"], 400000)
        self.assertEqual(data["renewalDueCount"], 1)
        self.assertEqual(data["renewalDue"][0]["name"], "Google Workspace – admin")

    def test_delete_keeps_log_entry(self):
        account_id = self._create().json()["id"]
        self.assertEqual(self.admin.delete(f"/api/company-accounts/{account_id}").status_code, 204)
        log = CompanyAccountLog.objects.get(action="delete")
        self.assertEqual(log.account_name, "Google Workspace – admin")
        self.assertIsNone(log.account_id)
