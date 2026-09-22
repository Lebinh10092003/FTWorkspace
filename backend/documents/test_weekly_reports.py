from datetime import date, time
from io import BytesIO
from unittest import mock
from zipfile import ZipFile

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token

from authentication.models import UserProfile, WorkspaceNotification
from work_schedule.models import WorkItem

from .models import WeeklyReport
from .weekly_report_docx import build_weekly_report_docx
from .weekly_reports import (
    build_schedule_reports,
    parse_weekly_report_tab,
    notify_staged_reports,
    report_generation_options,
    resolve_report_week_start,
    run_weekly_report_pipeline,
)


class WeeklyReportPipelineTests(TestCase):
    def setUp(self):
        self.employee = UserProfile.objects.create(
            email="phong@example.com",
            name="Mr Phong",
            role="EMPLOYEE",
            employment_status="ACTIVE",
            access_modules=[],
        )

    def _work(self, *, title, work_date, status=WorkItem.STATUS_TODO, **extra):
        return WorkItem.objects.create(
            creator=self.employee,
            executor=self.employee,
            title=title,
            work_date=work_date,
            status=status,
            **extra,
        )

    def test_builds_current_and_next_week_snapshot_from_work_schedule(self):
        self._work(
            title="Hoàn thành hồ sơ",
            work_date=date(2026, 9, 22),
            status=WorkItem.STATUS_COMPLETED,
            start_time=time(8, 30),
        )
        self._work(
            title="Chờ phản hồi khách hàng",
            work_date=date(2026, 9, 24),
            status=WorkItem.STATUS_DOING,
            progress_note="Đã gửi hồ sơ.",
        )
        self._work(title="Họp triển khai", work_date=date(2026, 9, 29))

        reports = build_schedule_reports(today=date(2026, 9, 25))

        report = next(report for report in reports if report.employee_email == self.employee.email)
        self.assertEqual((report.completed_week, report.planned_week), (39, 40))
        self.assertEqual(report.completed_items, ["08:30 · Hoàn thành hồ sơ"])
        self.assertEqual(report.difficulties, ["Chờ phản hồi khách hàng — Đã gửi hồ sơ."])
        self.assertEqual(report.planned_items, ["Họp triển khai"])
        self.assertEqual(report.status, WeeklyReport.STATUS_SNAPSHOT)

    def test_snapshot_retry_preserves_already_published_ai_report(self):
        report = WeeklyReport.objects.create(
            report_key="39-40-phong-example-com",
            employee_email=self.employee.email,
            employee_name=self.employee.name,
            completed_week=39,
            planned_week=40,
            completed_items=["Nội dung AI đã biên tập"],
            status=WeeklyReport.STATUS_PUBLISHED,
        )
        self._work(title="Công việc lịch", work_date=date(2026, 9, 22), status=WorkItem.STATUS_COMPLETED)

        reports = build_schedule_reports(today=date(2026, 9, 25))

        matching = next(item for item in reports if item.employee_email == self.employee.email)
        self.assertEqual(matching.pk, report.pk)
        report.refresh_from_db()
        self.assertEqual(report.completed_items, ["Nội dung AI đã biên tập"])
        self.assertEqual(report.status, WeeklyReport.STATUS_PUBLISHED)

    def test_manual_packet_scope_includes_only_the_requesting_employee(self):
        colleague = UserProfile.objects.create(
            email="colleague@example.com", name="Colleague", role="EMPLOYEE", employment_status="ACTIVE", access_modules=[],
        )
        self._work(title="Việc của Phong", work_date=date(2026, 9, 22), status=WorkItem.STATUS_COMPLETED)
        WorkItem.objects.create(
            creator=colleague,
            executor=colleague,
            title="Việc của đồng nghiệp",
            work_date=date(2026, 9, 22),
            status=WorkItem.STATUS_COMPLETED,
        )

        reports = build_schedule_reports(
            report_week_start=date(2026, 9, 21),
            employee_email=self.employee.email,
        )

        self.assertEqual([report.employee_email for report in reports], [self.employee.email])

    def test_sheet_stage_creates_an_idempotent_workspace_notification(self):
        report = WeeklyReport.objects.create(
            report_key="39-40-phong-staged",
            employee_email=self.employee.email,
            employee_name=self.employee.name,
            completed_week=39,
            planned_week=40,
        )

        self.assertEqual(notify_staged_reports([report]), 1)
        notification = WorkspaceNotification.objects.get()
        self.assertEqual(notification.target_emails, [self.employee.email])
        self.assertEqual(notification.action_url, "/communication-tools/weekly-report")
        self.assertEqual(notify_staged_reports([report]), 0)

    def test_parses_ai_tab_with_the_three_report_sections(self):
        def paragraph(value):
            return {"paragraph": {"elements": [{"textRun": {"content": value}}]}}

        parsed = parse_weekly_report_tab({
            "tabProperties": {"tabId": "tab-phong", "title": "Mr Phong"},
            "documentTab": {"body": {"content": [
                paragraph("BÁO CÁO\n"),
                paragraph("Kết quả tuần 39, nhiệm vụ dự kiến tuần 40\n"),
                paragraph("(Mr Phong)\n"),
                paragraph("1. Công việc đã thực hiện tuần 39\n"),
                paragraph("- Đã hoàn tất hồ sơ\n"),
                paragraph("2. Tồn tại, khó khăn, vướng mắc\n"),
                paragraph("• Chờ phản hồi\n"),
                paragraph("3. Nhiệm vụ tuần 40\n"),
                paragraph("- Họp triển khai\n"),
            ]}},
        })

        self.assertEqual(parsed, {
            "employee_name": "Mr Phong",
            "completed_week": 39,
            "planned_week": 40,
            "google_tab_id": "tab-phong",
            "completed_items": ["Đã hoàn tất hồ sơ"],
            "difficulties": ["Chờ phản hồi"],
            "planned_items": ["Họp triển khai"],
        })

    def test_docx_export_contains_the_generated_report_data(self):
        report = WeeklyReport.objects.create(
            report_key="39-40-phong-docx",
            employee_name="Mr Phong",
            completed_week=39,
            planned_week=40,
            completed_items=["Đã hoàn tất hồ sơ"],
            difficulties=["Không có"],
            planned_items=["Họp triển khai"],
        )

        filename, content = build_weekly_report_docx(report)

        self.assertTrue(filename.endswith(".docx"))
        self.assertTrue(content.startswith(b"PK"))
        with ZipFile(BytesIO(content)) as archive:
            document_xml = archive.read("word/document.xml").decode("utf-8")
        self.assertIn("Kết quả tuần 39", document_xml)
        self.assertIn("Họp triển khai", document_xml)


class WeeklyReportGenerationOptionsTests(TestCase):
    def test_monday_to_thursday_defaults_to_previous_week(self):
        options = report_generation_options(today=date(2026, 9, 22))  # Tuesday, week 39

        self.assertEqual([option["weekStart"] for option in options], [
            "2026-09-21", "2026-09-14", "2026-09-07", "2026-08-31",
        ])
        self.assertEqual(next(option for option in options if option["isDefault"])["weekStart"], "2026-09-14")

    def test_friday_to_sunday_defaults_to_current_week(self):
        options = report_generation_options(today=date(2026, 9, 25))  # Friday, week 39

        self.assertEqual(next(option for option in options if option["isDefault"])["weekStart"], "2026-09-21")

    def test_validation_rejects_a_week_more_than_three_weeks_old(self):
        self.assertEqual(resolve_report_week_start("2026-09-07", today=date(2026, 9, 25)), date(2026, 9, 7))
        with self.assertRaisesMessage(ValueError, "tối đa ba tuần trước"):
            resolve_report_week_start("2026-08-24", today=date(2026, 9, 25))

    @mock.patch("documents.weekly_reports.sync_reports_from_google_doc")
    @mock.patch("documents.weekly_reports.sync_reports_to_staging_sheet", return_value={"updatedTabs": 2})
    @mock.patch("documents.weekly_reports.build_schedule_reports", return_value=[])
    def test_packet_generation_stops_after_the_sheet_stage(self, build_reports, sync_sheet, sync_doc):
        result = run_weekly_report_pipeline(
            report_week_start=date(2026, 9, 14),
            sync_source=False,
        )

        self.assertEqual(result["weekStart"], "2026-09-14")
        build_reports.assert_called_once_with(report_week_start=date(2026, 9, 14), employee_email=None)
        sync_sheet.assert_called_once_with([], google_token=None)
        sync_doc.assert_not_called()


class WeeklyReportGenerationApiTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(
            username="manager@example.com", email="manager@example.com", password="StrongPassword9921",
        )
        UserProfile.objects.create(
            email="manager@example.com", name="Manager", role="MANAGER", employment_status="ACTIVE", access_modules=[],
        )
        self.token = Token.objects.create(user=user).key

    @mock.patch("documents.views.resolve_report_week_start", return_value=date(2026, 9, 14))
    @mock.patch("documents.views.run_weekly_report_pipeline", return_value={
        "completedWeek": 38, "plannedWeek": 39, "sheet": {"updatedTabs": 4},
    })
    def test_manager_can_create_the_selected_sheet_packet(self, pipeline, resolve_week):
        response = self.client.post(
            "/api/documents/weekly-reports/generate",
            {"weekStart": "2026-09-14"},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.json()["sheet"]["updatedTabs"], 4)
        resolve_week.assert_called_once_with("2026-09-14")
        pipeline.assert_called_once_with(
            report_week_start=date(2026, 9, 14),
            employee_email="manager@example.com",
        )


class WeeklyReportWebhookTests(TestCase):
    @mock.patch.dict("os.environ", {"WEEKLY_REPORT_WEBHOOK_SECRET": "weekly-test-secret"})
    @mock.patch("documents.views.sync_reports_from_google_doc", return_value={"created": 1, "updated": 0})
    def test_ai_webhook_requires_secret_then_refreshes_doc(self, sync_reports):
        rejected = self.client.post("/api/documents/weekly-reports/webhook", data={}, content_type="application/json")
        self.assertEqual(rejected.status_code, 401)

        accepted = self.client.post(
            "/api/documents/weekly-reports/webhook",
            data={},
            content_type="application/json",
            HTTP_X_WEEKLY_REPORT_WEBHOOK_SECRET="weekly-test-secret",
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json(), {"created": 1, "updated": 0})
        sync_reports.assert_called_once_with()
