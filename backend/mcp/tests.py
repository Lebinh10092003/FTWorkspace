import base64
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from authentication.models import UserProfile
from digital_training.models import TrainingPartner


class MCPFrameworkTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # 1. Admin user
        self.admin_password = "AdminPassword123"
        self.admin_user = User.objects.create_user(
            username="admin@fermat.vn", email="admin@fermat.vn", password=self.admin_password
        )
        self.admin_token = Token.objects.create(user=self.admin_user)
        self.admin_profile = UserProfile.objects.create(
            email="admin@fermat.vn",
            name="Quản Trị Viên",
            role="ADMIN",
            access_modules=["digital-training", "examination", "work-schedule", "attendance", "finance-report", "account-management"],
        )

        # 2. Employee with digital-training & work-schedule
        self.employee_password = "StaffPassword123"
        self.employee_user = User.objects.create_user(
            username="staff@fermat.vn", email="staff@fermat.vn", password=self.employee_password
        )
        self.employee_token = Token.objects.create(user=self.employee_user)
        self.employee_profile = UserProfile.objects.create(
            email="staff@fermat.vn",
            name="Nhân viên Kinh doanh",
            role="EMPLOYEE",
            access_modules=["digital-training", "work-schedule"],
        )

        # Sample data
        self.partner = TrainingPartner.objects.create(
            name="Trường THCS Thực Nghiệm",
            contact_person="Thầy Hoàng",
            phone="0912345678",
            province="Hà Nội",
        )

    def test_openapi_spec_generation(self):
        """Kiểm tra endpoint xuất lược đồ OpenAPI 3.1 cho ChatGPT Web."""
        response = self.client.get("/api/mcp/openapi.json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["openapi"], "3.1.0")
        self.assertIn("BasicAuth", data["components"]["securitySchemes"])
        self.assertIn("/action/auth_login", data["paths"])
        self.assertIn("/action/crm_search_customers", data["paths"])

    def test_basic_auth_with_system_account(self):
        """Đăng nhập bằng HTTP Basic Auth với Email và Mật khẩu hệ thống thông thường."""
        raw_cred = f"staff@fermat.vn:{self.employee_password}"
        b64_cred = base64.b64encode(raw_cred.encode("utf-8")).decode("utf-8")
        self.client.credentials(HTTP_AUTHORIZATION=f"Basic {b64_cred}")

        response = self.client.post("/api/mcp/action/system_whoami", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["data"]["email"], "staff@fermat.vn")
        self.assertEqual(body["data"]["role"], "EMPLOYEE")

    def test_in_chat_auth_login_tool(self):
        """Gọi tool auth_login bằng Email và Mật khẩu để lấy session_token trực tiếp."""
        # Gọi không có bất kỳ header xác thực nào
        self.client.credentials()
        response = self.client.post(
            "/api/mcp/action/auth_login",
            {"email": "staff@fermat.vn", "password": self.employee_password},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertTrue(body["success"])
        session_token = body["data"]["session_token"]
        self.assertTrue(bool(session_token))
        self.assertEqual(body["data"]["user"]["email"], "staff@fermat.vn")

        # Dùng session_token vừa nhận trong body để gọi công cụ nghiệp vụ
        search_res = self.client.post(
            "/api/mcp/action/crm_search_customers",
            {"query": "Thực Nghiệm", "session_token": session_token},
            format="json",
        )
        self.assertEqual(search_res.status_code, status.HTTP_200_OK)
        self.assertEqual(search_res.json()["data"]["count"], 1)

    def test_in_chat_auth_login_invalid_password(self):
        """Đăng nhập sai mật khẩu sẽ trả về lỗi rõ ràng."""
        response = self.client.post(
            "/api/mcp/action/auth_login",
            {"email": "staff@fermat.vn", "password": "WrongPassword"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertFalse(body["data"]["success"])
        self.assertIn("không chính xác", body["data"]["error"])

    def test_unauthenticated_protected_tool_rejected(self):
        """Yêu cầu không có thông tin xác thực nào sẽ bị từ chối 401."""
        self.client.credentials()
        response = self.client.post("/api/mcp/action/crm_search_customers", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_role_enforcement_blocks_finance_without_permission(self):
        """Nhân viên không có quyền kế toán/admin sẽ bị chặn khi gọi tool tài chính dù đăng nhập Basic Auth."""
        raw_cred = f"staff@fermat.vn:{self.employee_password}"
        b64_cred = base64.b64encode(raw_cred.encode("utf-8")).decode("utf-8")
        self.client.credentials(HTTP_AUTHORIZATION=f"Basic {b64_cred}")

        response = self.client.post("/api/mcp/action/finance_get_overview", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("Permission Denied", response.json()["error"])

    def test_admin_basic_auth_has_full_permission(self):
        """Admin đăng nhập bằng Basic Auth có quyền gọi mọi tool kể cả tài chính."""
        raw_cred = f"admin@fermat.vn:{self.admin_password}"
        b64_cred = base64.b64encode(raw_cred.encode("utf-8")).decode("utf-8")
        self.client.credentials(HTTP_AUTHORIZATION=f"Basic {b64_cred}")
        response = self.client.post("/api/mcp/action/finance_get_overview", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.json()["success"])

    def test_ai_access_key_lifecycle(self):
        """Kiểm tra tạo, xác thực và thu hồi AI Access Key riêng biệt."""
        from mcp.keys import create_ai_key, revoke_ai_key

        # 1. Tạo AI Access Key cho nhân viên
        key_data = create_ai_key("staff@fermat.vn", name="ChatGPT Test")
        raw_key = key_data["raw_key"]
        self.assertTrue(raw_key.startswith("ft_ai_"))

        # 2. Dùng AI Access Key để gọi công cụ
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw_key}")
        whoami_res = self.client.post("/api/mcp/action/system_whoami", {}, format="json")
        self.assertEqual(whoami_res.status_code, status.HTTP_200_OK)
        self.assertEqual(whoami_res.json()["data"]["email"], "staff@fermat.vn")

        # 3. Thu hồi key
        revoked = revoke_ai_key("staff@fermat.vn", key_data["id"])
        self.assertTrue(revoked)

        # 4. Key bị thu hồi sẽ không còn truy cập được
        blocked_res = self.client.post("/api/mcp/action/system_whoami", {}, format="json")
        self.assertEqual(blocked_res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_system_executive_dashboard(self):
        """Admin hoặc Manager có thể xem bản tin điều hành tổng hợp."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token.key}")
        response = self.client.post("/api/mcp/action/system_get_executive_dashboard", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()["data"]
        self.assertIn("executive_summary", data)
        self.assertIn("tasks", data["executive_summary"])
        self.assertIn("attendance", data["executive_summary"])

    def test_docs_generate_weekly_report(self):
        """Tự động trích xuất công việc trong tuần để lập báo cáo."""
        from work_schedule.models import WorkItem
        from django.utils import timezone

        # Tạo công việc mẫu
        WorkItem.objects.create(
            creator=self.employee_profile,
            executor=self.employee_profile,
            title="Soạn tài liệu hướng dẫn AI",
            work_date=timezone.localdate(),
            status=WorkItem.STATUS_COMPLETED,
        )

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.employee_token.key}")
        response = self.client.post("/api/mcp/action/docs_generate_weekly_report", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()["data"]
        self.assertTrue(data["success"])
        self.assertGreaterEqual(len(data["completed_items"]), 1)

    def test_mcp_sse_transport_endpoint(self):
        """Kiểm tra endpoint stream SSE cho Remote MCP."""
        response = self.client.get("/api/mcp/sse")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "text/event-stream")

    def test_cors_preflight_options(self):
        """Kiểm tra preflight OPTIONS request từ browser trả về CORS headers hợp lệ."""
        response = self.client.options("/api/mcp/openapi.json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Access-Control-Allow-Origin"], "*")
        self.assertIn("GET", response["Access-Control-Allow-Methods"])

        action_res = self.client.options("/api/mcp/action/system_whoami")
        self.assertEqual(action_res.status_code, status.HTTP_200_OK)
        self.assertEqual(action_res["Access-Control-Allow-Origin"], "*")

    def test_json_rpc_notifications_and_resources(self):
        """Kiểm tra chuẩn MCP: notifications/initialized và resources/list."""
        # 1. Notification initialized
        notif_res = self.client.post(
            "/api/mcp/rpc",
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            format="json",
        )
        self.assertEqual(notif_res.status_code, status.HTTP_200_OK)
        self.assertNotIn("error", notif_res.json())

        # 2. Resources list
        res_list = self.client.post(
            "/api/mcp/rpc",
            {"jsonrpc": "2.0", "id": "test-res", "method": "resources/list"},
            format="json",
        )
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        self.assertEqual(res_list.json()["result"]["resources"], [])

    def test_x_api_key_custom_header(self):
        """Hỗ trợ header X-API-Key (chuẩn phổ biến của Custom GPT) với mã ft_ai_..."""
        from mcp.keys import create_ai_key
        key_data = create_ai_key("staff@fermat.vn", name="GPT Custom Header")
        raw_key = key_data["raw_key"]

        # Gọi với header X-API-Key kèm tiền tố Bearer
        response = self.client.post(
            "/api/mcp/action/system_whoami",
            {},
            format="json",
            HTTP_X_API_KEY=f"Bearer {raw_key}",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["email"], "staff@fermat.vn")

    def test_openapi_request_body_optional_for_parameterless_tools(self):
        """Các tool không có tham số bắt buộc sẽ có requestBody.required = False."""
        response = self.client.get("/api/mcp/openapi.json")
        paths = response.json()["paths"]
        whoami_op = paths["/action/system_whoami"]["post"]
        self.assertFalse(whoami_op["requestBody"]["required"])

    def test_crm_subscriptions_and_renewal_tools(self):
        """Kiểm tra MCP tools: crm_list_subscriptions và crm_renew_subscription."""
        import datetime
        from django.utils import timezone
        from digital_training.models import TrainingProduct, TrainingProductSubscription

        product, _ = TrainingProduct.objects.get_or_create(code="ai-dung-chung", defaults={"name": "AI Dùng Chung"})
        today = timezone.localdate()
        expiry = today + datetime.timedelta(days=10)  # Sắp hết hạn
        sub = TrainingProductSubscription.objects.create(
            partner=self.partner,
            product=product,
            starts_at=today - datetime.timedelta(days=355),
            expires_at=expiry,
            quantity=100,
            status="active",
        )

        # 1. Tra cứu danh sách qua crm_list_subscriptions
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.employee_token.key}")
        list_res = self.client.post(
            "/api/mcp/action/crm_list_subscriptions",
            {"query": "Thực Nghiệm", "status_filter": "expiring"},
            format="json",
        )
        self.assertEqual(list_res.status_code, status.HTTP_200_OK)
        body = list_res.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["data"]["count"], 1)
        self.assertEqual(body["data"]["subscriptions"][0]["product_code"], "ai-dung-chung")
        self.assertEqual(body["data"]["subscriptions"][0]["status"], "expiring")

        # 2. Gia hạn thêm 12 tháng qua crm_renew_subscription
        renew_res = self.client.post(
            "/api/mcp/action/crm_renew_subscription",
            {"subscription_id": sub.id, "months_to_add": 12, "notes": "Hợp đồng số 123/2026"},
            format="json",
        )
        self.assertEqual(renew_res.status_code, status.HTTP_200_OK)
        renew_body = renew_res.json()
        self.assertTrue(renew_body["success"])
        self.assertGreater(renew_body["data"]["days_remaining"], 300)

        # 3. Kiểm tra DB đã cập nhật
        sub.refresh_from_db()
        self.assertEqual(sub.expires_at.year, expiry.year + 1)
        self.assertIn("Hợp đồng số 123/2026", sub.notes)

    def test_crm_ai_accounts_crud_and_import_export_tools(self):
        """Kiểm tra toàn bộ MCP tools cho TK AI Dùng chung: list, create, update, delete, import, export."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.employee_token.key}")

        # 1. Cấp mới 1 tài khoản AI (để trống mật khẩu để hệ thống tự sinh)
        create_res = self.client.post(
            "/api/mcp/action/crm_create_ai_account",
            {
                "partner_id": self.partner.id,
                "platform": "chatgpt_plus",
                "account_username": "thucnghiem.toan@fermat-ai.edu.vn",
                "assigned_to": "Tổ Toán",
                "status": "active",
            },
            format="json",
        )
        self.assertEqual(create_res.status_code, status.HTTP_200_OK)
        c_body = create_res.json()
        self.assertTrue(c_body["success"])
        acc_data = c_body["data"]["account"]
        self.assertEqual(acc_data["account_username"], "thucnghiem.toan@fermat-ai.edu.vn")
        self.assertEqual(len(acc_data["account_password"]), 12)  # Mật khẩu tự sinh
        self.assertEqual(c_body["data"]["partner_ai_account_count"], 1)

        # 2. Tra cứu danh sách qua crm_list_ai_accounts
        list_res = self.client.post(
            "/api/mcp/action/crm_list_ai_accounts",
            {"partner_id": self.partner.id, "platform": "chatgpt_plus"},
            format="json",
        )
        self.assertEqual(list_res.status_code, status.HTTP_200_OK)
        l_body = list_res.json()
        self.assertTrue(l_body["success"])
        self.assertEqual(l_body["data"]["count"], 1)
        acc_id = l_body["data"]["accounts"][0]["id"]

        # 3. Cập nhật tài khoản qua crm_update_ai_account
        up_res = self.client.post(
            "/api/mcp/action/crm_update_ai_account",
            {
                "account_id": acc_id,
                "new_password": "NewSecretPass2026!",
                "assigned_to": "Thầy Tuấn (Tổ trưởng)",
            },
            format="json",
        )
        self.assertEqual(up_res.status_code, status.HTTP_200_OK)
        up_body = up_res.json()
        self.assertTrue(up_body["success"])
        self.assertEqual(up_body["data"]["account"]["account_password"], "NewSecretPass2026!")
        self.assertEqual(up_body["data"]["account"]["assigned_to"], "Thầy Tuấn (Tổ trưởng)")

        # 4. Nhập hàng loạt tài khoản qua crm_import_ai_accounts (raw_text định dạng email | pass | người nhận)
        raw_text = (
            "thucnghiem.van@fermat-ai.edu.vn | PassVan123! | Cô Hạnh (Tổ Văn)\n"
            "thucnghiem.anh@fermat-ai.edu.vn | PassAnh456! | Thầy Minh (Tổ Ngoại ngữ)"
        )
        import_res = self.client.post(
            "/api/mcp/action/crm_import_ai_accounts",
            {
                "partner_id": self.partner.id,
                "raw_text": raw_text,
                "default_platform": "claude_pro",
            },
            format="json",
        )
        self.assertEqual(import_res.status_code, status.HTTP_200_OK)
        imp_body = import_res.json()
        self.assertTrue(imp_body["success"])
        self.assertEqual(imp_body["data"]["count"], 2)
        # Tổng tài khoản đang dùng: 1 cũ + 2 mới = 3
        self.assertEqual(imp_body["data"]["partner_ai_account_count"], 3)

        # 5. Xuất danh sách tài khoản qua crm_export_ai_accounts (định dạng CSV UTF-8 BOM)
        export_res = self.client.post(
            "/api/mcp/action/crm_export_ai_accounts",
            {"partner_id": self.partner.id, "format": "csv"},
            format="json",
        )
        self.assertEqual(export_res.status_code, status.HTTP_200_OK)
        exp_body = export_res.json()
        self.assertTrue(exp_body["success"])
        self.assertEqual(exp_body["data"]["count"], 3)
        self.assertTrue(exp_body["data"]["csv_content"].startswith("\ufeff"))
        self.assertIn("thucnghiem.toan@fermat-ai.edu.vn", exp_body["data"]["csv_content"])
        self.assertIn("thucnghiem.van@fermat-ai.edu.vn", exp_body["data"]["csv_content"])

        # 6. Xóa tài khoản qua crm_delete_ai_account
        del_res = self.client.post(
            "/api/mcp/action/crm_delete_ai_account",
            {"account_id": acc_id, "permanent": True},
            format="json",
        )
        self.assertEqual(del_res.status_code, status.HTTP_200_OK)
        del_body = del_res.json()
        self.assertTrue(del_body["success"])
        self.assertEqual(del_body["data"]["partner_ai_account_count"], 2)

    def test_crm_subscriptions_import_and_export_tools(self):
        """Kiểm tra MCP tools: crm_export_subscriptions và crm_import_subscriptions."""
        from digital_training.models import TrainingProduct
        TrainingProduct.objects.get_or_create(code="bndc", defaults={"name": "BNDC"})
        TrainingProduct.objects.get_or_create(code="lop-hoc-so", defaults={"name": "Lớp học số"})

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.employee_token.key}")

        # 1. Nhập hàng loạt gói dịch vụ qua crm_import_subscriptions
        raw_subscriptions = (
            f"{self.partner.name} | bndc | 80 | 2026-01-01 | 2027-01-01 | Gói BNDC 2026\n"
            f"{self.partner.name} | lop-hoc-so | 40 | 2026-02-01 | 2027-02-01 | Gói Lớp học số"
        )
        import_res = self.client.post(
            "/api/mcp/action/crm_import_subscriptions",
            {
                "raw_text": raw_subscriptions,
                "sync_sheet": False,
            },
            format="json",
        )
        self.assertEqual(import_res.status_code, status.HTTP_200_OK)
        imp_body = import_res.json()
        self.assertTrue(imp_body["success"])
        self.assertEqual(imp_body["data"]["created_count"] + imp_body["data"]["updated_count"], 2)

        # 2. Xuất dữ liệu qua crm_export_subscriptions (CSV có UTF-8 BOM)
        export_res = self.client.post(
            "/api/mcp/action/crm_export_subscriptions",
            {"query": "Thực Nghiệm", "format": "csv"},
            format="json",
        )
        self.assertEqual(export_res.status_code, status.HTTP_200_OK)
        exp_body = export_res.json()
        self.assertTrue(exp_body["success"])
        self.assertGreaterEqual(exp_body["data"]["count"], 2)
        self.assertTrue(exp_body["data"]["csv_content"].startswith("\ufeff"))
        self.assertIn("BNDC", exp_body["data"]["csv_content"])



