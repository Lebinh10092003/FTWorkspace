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

    def test_oauth_protected_resource_metadata(self):
        """/.well-known/ phai tra 200 JSON RFC 9728 de Claude / Cursor khong hien loi OAuth."""
        # Nginx xu ly /.well-known/ trong production; endpoint Django la /api/mcp/.well-known/
        res = self.client.get("/api/mcp/.well-known/oauth-protected-resource")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.json()
        self.assertIn("resource", data)
        self.assertIn("bearer_methods_supported", data)
        self.assertIn("header", data["bearer_methods_supported"])
        self.assertIn("query", data["bearer_methods_supported"])
        self.assertIn("mcp", data["resource"])
        self.assertEqual(res["Cache-Control"], "no-store")
        self.assertEqual(res["Access-Control-Allow-Origin"], "*")

    def test_openapi_spec_generation(self):
        """Kiểm tra endpoint xuất lược đồ OpenAPI 3.1 cho ChatGPT Web."""
        response = self.client.get("/api/mcp/openapi.json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["openapi"], "3.1.0")
        self.assertIn("BasicAuth", data["components"]["securitySchemes"])
        self.assertIn("/action/auth_login", data["paths"])
        self.assertIn("/action/crm_search_customers", data["paths"])

    def test_basic_auth_with_account_password_is_rejected(self):
        """MCP không nhận mật khẩu tài khoản (mật khẩu sẽ nằm lại trong lịch sử chat/AI)."""
        raw_cred = f"staff@fermat.vn:{self.employee_password}"
        b64_cred = base64.b64encode(raw_cred.encode("utf-8")).decode("utf-8")
        self.client.credentials(HTTP_AUTHORIZATION=f"Basic {b64_cred}")
        response = self.client.post("/api/mcp/action/system_whoami", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        self.client.credentials(HTTP_X_USER_EMAIL="staff@fermat.vn", HTTP_X_USER_PASSWORD=self.employee_password)
        self.assertEqual(self.client.post("/api/mcp/action/system_whoami", {}, format="json").status_code, 401)

        self.client.credentials()
        response = self.client.post(
            "/api/mcp/action/system_whoami",
            {"auth_email": "staff@fermat.vn", "auth_password": self.employee_password},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_basic_auth_with_ai_key(self):
        """Custom GPT dùng Basic Auth: dán mã ft_ai_ vào ô password."""
        from .keys import create_ai_key
        raw_key = create_ai_key("staff@fermat.vn", "Custom GPT")["raw_key"]
        b64_cred = base64.b64encode(f"staff@fermat.vn:{raw_key}".encode("utf-8")).decode("utf-8")
        self.client.credentials(HTTP_AUTHORIZATION=f"Basic {b64_cred}")
        response = self.client.post("/api/mcp/action/system_whoami", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["email"], "staff@fermat.vn")

    def test_auth_login_only_explains_how_to_connect(self):
        """auth_login không nhận mật khẩu và không trả token phiên web vào khung chat."""
        self.client.credentials()
        response = self.client.post(
            "/api/mcp/action/auth_login",
            {"email": "staff@fermat.vn", "password": self.employee_password},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()["data"]
        self.assertFalse(data["success"])
        self.assertNotIn("session_token", data)
        self.assertNotIn(self.employee_token.key, response.content.decode("utf-8"))
        self.assertIn("ft_ai_", " ".join(data["how_to_connect"]))

        # Token phiên web gửi trong tham số công cụ cũng không được nhận.
        res = self.client.post(
            "/api/mcp/action/crm_search_customers",
            {"query": "Thực Nghiệm", "session_token": self.employee_token.key},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_unauthenticated_protected_tool_rejected(self):
        """Yêu cầu không có thông tin xác thực nào sẽ bị từ chối 401."""
        self.client.credentials()
        response = self.client.post("/api/mcp/action/crm_search_customers", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_role_enforcement_blocks_finance_without_permission(self):
        """Nhân viên không có quyền kế toán/admin sẽ bị chặn khi gọi tool tài chính dù đăng nhập Basic Auth."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.employee_token.key}")

        response = self.client.post("/api/mcp/action/finance_get_overview", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("Permission Denied", response.json()["error"])

    def test_admin_basic_auth_has_full_permission(self):
        """Admin đăng nhập bằng Basic Auth có quyền gọi mọi tool kể cả tài chính."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token.key}")
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

    def test_mcp_sse_legacy_path_serves_streamable_http(self):
        """/api/mcp/sse cũ: GET trả 405 (không treo), POST xử lý như Streamable HTTP."""
        response = self.client.get("/api/mcp/sse")
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        post_res = self.client.post("/api/mcp/sse", {"jsonrpc": "2.0", "id": 1, "method": "ping"}, format="json")
        self.assertEqual(post_res.status_code, status.HTTP_200_OK)
        self.assertEqual(post_res.json()["result"], {})

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
        self.assertEqual(notif_res.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(notif_res.content, b"")

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

    def test_all_modules_export_tools(self):
        """Kiểm tra các công cụ xuất (export) dữ liệu CSV/JSON trên tất cả các phân hệ."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.admin_token.key}")

        # 1. Khảo thí: exam_export_candidates
        exam_res = self.client.post(
            "/api/mcp/action/exam_export_candidates",
            {"format": "csv"},
            format="json",
        )
        self.assertEqual(exam_res.status_code, status.HTTP_200_OK)
        exam_body = exam_res.json()
        self.assertTrue(exam_body["success"])
        self.assertTrue(exam_body["data"]["csv_content"].startswith("\ufeff"))

        # 2. Lịch công tác: schedule_export_tasks
        sched_res = self.client.post(
            "/api/mcp/action/schedule_export_tasks",
            {"format": "csv"},
            format="json",
        )
        self.assertEqual(sched_res.status_code, status.HTTP_200_OK)
        sched_body = sched_res.json()
        self.assertTrue(sched_body["success"])
        self.assertTrue(sched_body["data"]["csv_content"].startswith("\ufeff"))

        # 3. Chấm công: attendance_export_monthly_report
        att_res = self.client.post(
            "/api/mcp/action/attendance_export_monthly_report",
            {"format": "csv"},
            format="json",
        )
        self.assertEqual(att_res.status_code, status.HTTP_200_OK)
        att_body = att_res.json()
        self.assertTrue(att_body["success"])
        self.assertTrue(att_body["data"]["csv_content"].startswith("\ufeff"))

        # 4. Tài chính: finance_export_entries
        fin_res = self.client.post(
            "/api/mcp/action/finance_export_entries",
            {"format": "csv"},
            format="json",
        )
        self.assertEqual(fin_res.status_code, status.HTTP_200_OK)
        fin_body = fin_res.json()
        self.assertTrue(fin_body["success"])
        self.assertTrue(fin_body["data"]["csv_content"].startswith("\ufeff"))

        # 5. Tập huấn: training_export_sessions
        train_res = self.client.post(
            "/api/mcp/action/training_export_sessions",
            {"format": "csv"},
            format="json",
        )
        self.assertEqual(train_res.status_code, status.HTTP_200_OK)
        train_body = train_res.json()
        self.assertTrue(train_body["success"])
        self.assertTrue(train_body["data"]["csv_content"].startswith("\ufeff"))

        # 6. Danh bạ nhân sự: system_export_staff_directory
        staff_res = self.client.post(
            "/api/mcp/action/system_export_staff_directory",
            {"format": "csv"},
            format="json",
        )
        self.assertEqual(staff_res.status_code, status.HTTP_200_OK)
        staff_body = staff_res.json()
        self.assertTrue(staff_body["success"])
        self.assertTrue(staff_body["data"]["csv_content"].startswith("\ufeff"))

        # 7. Báo cáo tuần: docs_export_weekly_reports
        doc_res = self.client.post(
            "/api/mcp/action/docs_export_weekly_reports",
            {"format": "csv"},
            format="json",
        )
        self.assertEqual(doc_res.status_code, status.HTTP_200_OK)
        doc_body = doc_res.json()
        self.assertTrue(doc_body["success"])
        self.assertTrue(doc_body["data"]["csv_content"].startswith("\ufeff"))

    def test_funding_proposal_lifecycle_mcp(self):
        """Kiểm tra toàn bộ chu trình MCP cho Phiếu đề xuất kinh phí (Funding Proposal)."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.admin_token.key}")

        # 1. Tính toán trước dự toán
        calc_res = self.client.post(
            "/api/mcp/action/docs_calculate_funding_totals",
            {
                "items": [
                    {"description": "Thuê hội trường", "unit": "ngày", "quantity": 2, "unit_price": 2500000},
                    {"description": "In tài liệu", "unit": "bộ", "quantity": 50, "unit_price": 40000},
                ],
                "vat_rate": 10,
                "other_cost": 300000,
            },
            format="json",
        )
        self.assertEqual(calc_res.status_code, status.HTTP_200_OK)
        calc_data = calc_res.json()["data"]
        self.assertEqual(calc_data["subtotal"], 7000000)
        self.assertEqual(calc_data["vat_amount"], 700000)
        self.assertEqual(calc_data["other_cost"], 300000)
        self.assertEqual(calc_data["grand_total"], 8000000)
        self.assertIn("Tám triệu đồng chẵn", calc_data["in_words"])

        # 2. Tạo phiếu đề xuất kinh phí hoàn chỉnh
        create_res = self.client.post(
            "/api/mcp/action/docs_create_funding_proposal",
            {
                "project": "Tập huấn giáo viên Robothon hè 2026",
                "purpose": "Đào tạo phương pháp giảng dạy Robotics cho 50 trường tiểu học",
                "proposer": "Lê Bình",
                "department": "Khối Công nghệ & Đào tạo số",
                "approval_deadline": "2026-11-15",
                "items": [
                    {"description": "Thuê hội trường", "unit": "ngày", "quantity": 2, "unit_price": 2500000},
                    {"description": "In tài liệu", "unit": "bộ", "quantity": 50, "unit_price": 40000},
                ],
                "vat_rate": 10,
                "other_cost": 300000,
                "supplier": "Trung tâm Hội nghị Quốc tế",
                "payment_method": "transfer",
                "return_base64": True,
            },
            format="json",
        )
        self.assertEqual(create_res.status_code, status.HTTP_200_OK)
        create_data = create_res.json()["data"]
        self.assertTrue(create_data["success"])
        self.assertIn("/PĐXKP-FT", create_data["document_number"])
        draft_id = create_data["draft_id"]
        doc_number = create_data["document_number"]
        self.assertIn("docx_base64", create_data)

        # 3. Tra cứu chi tiết phiếu đề xuất bằng draft_id
        get_res1 = self.client.post(
            "/api/mcp/action/docs_get_funding_proposal",
            {"proposal_id": draft_id},
            format="json",
        )
        self.assertEqual(get_res1.status_code, status.HTTP_200_OK)
        get_data1 = get_res1.json()["data"]
        self.assertEqual(get_data1["document_number"], doc_number)
        self.assertEqual(get_data1["project"], "Tập huấn giáo viên Robothon hè 2026")
        self.assertEqual(len(get_data1["items"]), 2)

        # 4. Tra cứu chi tiết phiếu đề xuất bằng document_number
        get_res2 = self.client.post(
            "/api/mcp/action/docs_get_funding_proposal",
            {"proposal_id": doc_number},
            format="json",
        )
        self.assertEqual(get_res2.status_code, status.HTTP_200_OK)
        self.assertEqual(get_res2.json()["data"]["draft_id"], draft_id)

        # 5. Xem danh sách và tìm kiếm phiếu đề xuất
        list_res = self.client.post(
            "/api/mcp/action/docs_list_funding_proposals",
            {"query": "Robothon"},
            format="json",
        )
        self.assertEqual(list_res.status_code, status.HTTP_200_OK)
        list_data = list_res.json()["data"]
        self.assertGreaterEqual(list_data["count"], 1)
        self.assertEqual(list_data["proposals"][0]["document_number"], doc_number)

    def test_email_builder_and_signature_mcp(self):
        """Kiểm tra toàn bộ chu trình MCP cho Email Builder & Signature Builder."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.admin_token.key}")

        # 1. Tạo mẫu email mới
        create_res = self.client.post(
            "/api/mcp/action/email_create_template",
            {
                "name": "Thư mời tham dự kỳ thi Toán Quốc tế FIMO 2026",
                "subject": "[FermatTech] Thư mời tham gia kỳ thi FIMO 2026",
                "blocks": [
                    {"type": "heading", "content": "KỲ THI TOÁN QUỐC TẾ FIMO 2026"},
                    {"type": "text", "content": "Kính gửi Ban Giám hiệu và các Thầy Cô giáo..."},
                    {"type": "button", "text": "Đăng ký ngay", "url": "https://fimo.fermat.vn"},
                ],
                "is_published": True,
            },
            format="json",
        )
        self.assertEqual(create_res.status_code, status.HTTP_200_OK)
        template_id = create_res.json()["data"]["id"]
        self.assertTrue(create_res.json()["data"]["is_published"])

        # 2. Xem danh sách mẫu email
        list_res = self.client.post(
            "/api/mcp/action/email_list_templates",
            {"query": "FIMO"},
            format="json",
        )
        self.assertEqual(list_res.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(list_res.json()["data"]["count"], 1)

        # 3. Lấy chi tiết mẫu email
        get_res = self.client.post(
            "/api/mcp/action/email_get_template",
            {"template_id": template_id},
            format="json",
        )
        self.assertEqual(get_res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(get_res.json()["data"]["blocks"]), 3)

        # 4. Sửa mẫu email
        update_res = self.client.post(
            "/api/mcp/action/email_update_template",
            {
                "template_id": template_id,
                "name": "Thư mời tham dự kỳ thi FIMO 2026 (Đã cập nhật)",
            },
            format="json",
        )
        self.assertEqual(update_res.status_code, status.HTTP_200_OK)
        self.assertEqual(update_res.json()["data"]["name"], "Thư mời tham dự kỳ thi FIMO 2026 (Đã cập nhật)")

        # 5. Xóa mẫu email
        del_res = self.client.post(
            "/api/mcp/action/email_delete_template",
            {"template_id": template_id},
            format="json",
        )
        self.assertEqual(del_res.status_code, status.HTTP_200_OK)

        # 6. Sinh chữ ký email HTML
        sig_res = self.client.post(
            "/api/mcp/action/signature_generate_html",
            {
                "full_name": "Nguyễn Văn Tuấn",
                "job_title": "Chuyên viên Khảo thí",
                "department": "Ban Khảo thí & Cuộc thi",
                "phone": "0987654321",
                "email": "tuan.nv@fermat.edu.vn",
            },
            format="json",
        )
        self.assertEqual(sig_res.status_code, status.HTTP_200_OK)
        sig_data = sig_res.json()["data"]
        self.assertIn("Nguyễn Văn Tuấn", sig_data["signature_html"])
        self.assertIn("0987654321", sig_data["signature_html"])
        self.assertIn("FERMATTECH", sig_data["signature_html"])







class MCPStreamableHttpTests(TestCase):
    """Bat tay MCP tren /api/mcp nhu Claude / Cursor / ChatGPT thuc hien."""

    def setUp(self):
        from mcp.keys import create_ai_key

        self.client = APIClient()
        UserProfile.objects.create(
            email="staff@fermat.vn", name="Nhan vien", role="EMPLOYEE", access_modules=["digital-training"],
        )
        User.objects.create_user(username="staff@fermat.vn", email="staff@fermat.vn", password="x-Pass-123")
        self.key = create_ai_key("staff@fermat.vn", name="Claude")["raw_key"]
        self.bearer = {"HTTP_AUTHORIZATION": f"Bearer {self.key}"}

    def rpc(self, body, url="/api/mcp", **extra):
        return self.client.post(url, body, format="json", HTTP_ACCEPT="application/json, text/event-stream", **extra)

    def tool_names(self, response):
        return {t["name"] for t in response.json()["result"]["tools"]}

    def test_initialize_negotiates_protocol_version(self):
        for version in ("2025-06-18", "2024-11-05"):
            res = self.rpc({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": version}}, **self.bearer)
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["result"]["protocolVersion"], version)
        unknown = self.rpc({"jsonrpc": "2.0", "id": 3, "method": "initialize", "params": {"protocolVersion": "1999-01-01"}}, **self.bearer)
        self.assertEqual(unknown.json()["result"]["protocolVersion"], "2025-11-25")

    def test_get_returns_405(self):
        self.assertEqual(self.client.get("/api/mcp").status_code, 405)

    def test_tools_list_requires_key(self):
        anon = self.rpc({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        self.assertEqual(anon.status_code, 401)
        self.assertIn("Bearer", anon["WWW-Authenticate"])
        authed = self.rpc({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, **self.bearer)
        self.assertIn("crm_search_customers", self.tool_names(authed))

    def test_key_in_url_query(self):
        url = f"/api/mcp?key={self.key}"
        init = self.rpc({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}, url=url)
        self.assertEqual(init.status_code, 200)
        res = self.rpc(
            {"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": "system_whoami", "arguments": {}}},
            url=url,
        )
        self.assertEqual(res.status_code, 200)
        result = res.json()["result"]
        self.assertFalse(result["isError"])
        self.assertIn("staff@fermat.vn", result["content"][0]["text"])
        self.assertNotIn(self.key, res.content.decode("utf-8"))

    def test_invalid_or_non_key_value_in_url_is_rejected(self):
        for value in ("ft_ai_not-a-real-key", "x-Pass-123"):
            res = self.rpc({"jsonrpc": "2.0", "id": 7, "method": "tools/list"}, url=f"/api/mcp?key={value}")
            self.assertEqual(res.status_code, 401, value)

    def test_bad_arguments_return_readable_tool_error(self):
        res = self.rpc(
            {"jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": {"name": "crm_create_ai_account", "arguments": {}}},
            **self.bearer,
        )
        self.assertEqual(res.status_code, 200)
        result = res.json()["result"]
        self.assertTrue(result["isError"])
        self.assertIn("crm_create_ai_account", result["content"][0]["text"])

    def test_unknown_tool(self):
        res = self.rpc({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "nope"}}, **self.bearer)
        self.assertEqual(res.json()["error"]["code"], -32601)
