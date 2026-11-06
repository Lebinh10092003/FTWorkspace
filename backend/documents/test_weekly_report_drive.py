"""Weekly report: fuller drafts, richer AI input and saving into Drive "TUAN NN"."""

import json
import re
from datetime import date, datetime, time
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token

from authentication.models import UserProfile
from work_schedule.models import WorkItem

from .ai_service import build_ai_report_prompt, process_ai_job
from .models import AiReportJob, WeeklyReport
from .weekly_report_drive import (
    APP_PROPERTY,
    FOLDER_MIME,
    archive_week_reports,
    drive_file_name,
    learn_employee_slots,
    run_friday_weekly_reports,
    save_report_to_drive,
)
from .weekly_reports import build_schedule_reports, report_week_dates

PARENT = "parent-folder"


class _Call:
    def __init__(self, result):
        self._result = result

    def execute(self):
        return self._result


class FakeDrive:
    """Just enough of the Drive v3 files() API for the archive code."""

    def __init__(self):
        self.items = {}
        self.counter = 0
        self.creates = 0
        self.updates = 0

    def add(self, name, parent, *, folder=False, app=None):
        self.counter += 1
        file_id = f"id{self.counter}"
        self.items[file_id] = {
            "id": file_id,
            "name": name,
            "parents": [parent],
            "mimeType": FOLDER_MIME if folder else "application/docx",
            "appProperties": dict(app or {}),
            "webViewLink": f"https://drive.example/{file_id}",
        }
        return file_id

    def files(self):
        return self

    def list(self, q, **_kwargs):
        parent = re.search(r"'([^']+)' in parents", q).group(1)
        want_folder = f"mimeType = '{FOLDER_MIME}'" in q
        files = [
            dict(item) for item in self.items.values()
            if parent in item["parents"] and (item["mimeType"] == FOLDER_MIME) == want_folder
        ]
        return _Call({"files": files})

    def create(self, body, media_body=None, **_kwargs):
        self.creates += 1
        file_id = self.add(
            body["name"], body["parents"][0],
            folder=body.get("mimeType") == FOLDER_MIME, app=body.get("appProperties"),
        )
        return _Call(dict(self.items[file_id]))

    def update(self, fileId, body, media_body=None, **_kwargs):
        self.updates += 1
        self.items[fileId]["name"] = body["name"]
        return _Call(dict(self.items[fileId]))

    def names_in(self, folder_id):
        return sorted(item["name"] for item in self.items.values() if folder_id in item["parents"])

    def folder(self, name):
        return next(item["id"] for item in self.items.values() if item["name"] == name and item["mimeType"] == FOLDER_MIME)


def _profile(email, name):
    return UserProfile.objects.create(email=email, name=name, role="EMPLOYEE", employment_status="ACTIVE", access_modules=[])


class DriveFixtureMixin:
    def setUp(self):
        self.binh = _profile("binh@fermat.vn", "Lê Văn Bình")
        self.ha = _profile("ha@fermat.vn", "Nguyễn Hải Hà")
        self.khanh_ha = _profile("khanhha@fermat.vn", "Đàm Khánh Hà")
        self.thuan = _profile("thuan@fermat.vn", "Lê Đức Thuận")
        self.drive = FakeDrive()
        w44 = self.drive.add("TUAN 44", PARENT, folder=True)
        self.drive.add("1. BC KQ tuần 44, NV tuần 45 (FermatTech).docx", w44)
        self.drive.add("4. BC KQ tuần 44, NV tuần 45 (Ms Hà).docx", w44)
        self.drive.add("5. BC KQ tuần 44, NV tuần 45 (Mr Bình).docx", w44)
        self.drive.add("10. BC KQ tuần 44, NV tuần 45 (Ms Khánh Hà).docx", w44)
        w42 = self.drive.add("TUAN 42", PARENT, folder=True)
        self.drive.add("1. BC KQ tuần 42, NV tuần 43 (Mr Thuận).docx", w42)
        env = mock.patch.dict("os.environ", {"WEEKLY_REPORT_DRIVE_FOLDER_ID": PARENT})
        env.start()
        self.addCleanup(env.stop)

    def _work(self, executor, title, work_date, status=WorkItem.STATUS_COMPLETED, **extra):
        return WorkItem.objects.create(
            creator=executor, executor=executor, title=title, work_date=work_date, status=status, **extra,
        )


class DriveSlotLearningTests(DriveFixtureMixin, TestCase):
    def test_learns_number_and_label_and_settles_shared_given_names(self):
        folders = {44: self.drive.folder("TUAN 44"), 42: self.drive.folder("TUAN 42")}
        profiles = list(UserProfile.objects.all())

        slots = learn_employee_slots(self.drive, folders, 45, profiles)

        self.assertEqual((slots["binh@fermat.vn"].number, slots["binh@fermat.vn"].label), (5, "Mr Bình"))
        # "Ms Hà" fits two people; "Ms Khánh Hà" claims one, so the other is Nguyễn Hải Hà.
        self.assertEqual((slots["ha@fermat.vn"].number, slots["ha@fermat.vn"].label), (4, "Ms Hà"))
        self.assertEqual(slots["khanhha@fermat.vn"].number, 10)
        # Number 1 now belongs to the company summary, so the old "Mr Thuận" slot is not reused.
        self.assertNotIn("thuan@fermat.vn", slots)

    def test_drive_file_name_follows_the_folder_convention(self):
        report = WeeklyReport(employee_name="Lê Văn Bình", employee_email="binh@fermat.vn", completed_week=45, planned_week=46)
        folders = {44: self.drive.folder("TUAN 44")}
        slot = learn_employee_slots(self.drive, folders, 45, list(UserProfile.objects.all()))["binh@fermat.vn"]

        self.assertEqual(drive_file_name(report, slot), "5. BC KQ tuần 45, NV tuần 46 (Mr Bình).docx")
        self.assertEqual(drive_file_name(report, None), "BC KQ tuần 45, NV tuần 46 (Lê Văn Bình).docx")


class FridayRunTests(DriveFixtureMixin, TestCase):
    def setUp(self):
        super().setUp()
        for day in range(2, 7):
            for index in range(5):
                self._work(self.binh, f"Việc {day}-{index} với Trường A", date(2026, 11, day))
        self._work(self.binh, "Họp kế hoạch tuần 46", date(2026, 11, 10), status=WorkItem.STATUS_TODO)
        self._work(self.ha, "Lập bảng lương tháng 10", date(2026, 11, 3))
        self._work(self.khanh_ha, "Hỗ trợ tuyển sinh", date(2026, 11, 4))
        self._work(self.thuan, "Làm việc với đối tác", date(2026, 11, 4))
        # Ms Hà has already uploaded her own file this week.
        w45 = self.drive.add("TUAN 45", PARENT, folder=True)
        self.drive.add("4. BC KQ tuần 45, NV tuần 46 (Ms Hà).docx", w45)

    def test_saves_full_drafts_queues_ai_and_never_overwrites_own_uploads(self):
        result = run_friday_weekly_reports(today=date(2026, 11, 6), service=self.drive)

        binh = WeeklyReport.objects.get(employee_email="binh@fermat.vn", completed_week=45)
        self.assertEqual(len(binh.completed_items), 25)  # all of them, not the old 5-item cut
        w45 = self.drive.folder("TUAN 45")
        self.assertEqual(self.drive.names_in(w45), [
            "10. BC KQ tuần 45, NV tuần 46 (Ms Khánh Hà).docx",
            "4. BC KQ tuần 45, NV tuần 46 (Ms Hà).docx",
            "5. BC KQ tuần 45, NV tuần 46 (Mr Bình).docx",
        ])
        self.assertEqual(binh.drive_file_name, "5. BC KQ tuần 45, NV tuần 46 (Mr Bình).docx")
        self.assertIn("ha@fermat.vn", [UserProfile.objects.get(name=row["employee"]).email for row in result["skipped"]])
        # Thuận has no weekly slot in the folder, so the Friday run leaves him out.
        self.assertFalse(WeeklyReport.objects.get(employee_email="thuan@fermat.vn").drive_file_id)
        jobs = AiReportJob.objects.filter(save_to_drive=True)
        self.assertEqual(sorted(job.user_id for job in jobs), ["binh@fermat.vn", "khanhha@fermat.vn"])
        self.assertEqual(result["aiQueued"], 2)

        # A second run refreshes the same files instead of adding copies or AI jobs.
        creates = self.drive.creates
        run_friday_weekly_reports(today=date(2026, 11, 6), service=self.drive)
        self.assertEqual(self.drive.creates, creates)
        self.assertEqual(len(self.drive.names_in(w45)), 3)
        self.assertEqual(AiReportJob.objects.count(), 2)

    def test_one_employee_failing_does_not_stop_the_others(self):
        build_schedule_reports(report_week_start=date(2026, 11, 2))
        real = __import__("documents.weekly_report_docx", fromlist=["build_weekly_report_docx"]).build_weekly_report_docx

        def flaky(report):
            if report.employee_email == "khanhha@fermat.vn":
                raise RuntimeError("hỏng")
            return real(report)

        with mock.patch("documents.weekly_report_drive.build_weekly_report_docx", side_effect=flaky):
            result = archive_week_reports(45, service=self.drive)

        self.assertEqual([row["employee"] for row in result["failed"]], ["Đàm Khánh Hà"])
        self.assertEqual([row["employee"] for row in result["saved"]], ["Lê Văn Bình"])


class SaveToDriveApiTests(DriveFixtureMixin, TestCase):
    def setUp(self):
        super().setUp()
        user = get_user_model().objects.create_user(username="binh@fermat.vn", email="binh@fermat.vn")
        self.headers = {"HTTP_AUTHORIZATION": f"Bearer {Token.objects.create(user=user).key}"}
        self.own = WeeklyReport.objects.create(
            report_key="45-46-binh", employee_email="binh@fermat.vn", employee_name="Lê Văn Bình",
            completed_week=45, planned_week=46, completed_items=["Hoàn thành slide"],
        )
        self.other = WeeklyReport.objects.create(
            report_key="45-46-ha", employee_email="ha@fermat.vn", employee_name="Nguyễn Hải Hà",
            completed_week=45, planned_week=46, completed_items=["Lập bảng lương"],
        )

    def test_owner_saves_and_sees_the_drive_link(self):
        with mock.patch("documents.weekly_report_drive._drive_service", return_value=self.drive):
            response = self.client.post(f"/api/documents/weekly-reports/{self.own.pk}/drive", **self.headers)

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()["report"]
        self.assertEqual(payload["driveFileName"], "5. BC KQ tuần 45, NV tuần 46 (Mr Bình).docx")
        self.assertTrue(payload["driveFileUrl"])
        self.assertTrue(payload["completedRange"].endswith("/2026"))

    def test_existing_own_upload_is_reported_not_overwritten(self):
        w45 = self.drive.add("TUAN 45", PARENT, folder=True)
        self.drive.add("5. BC KQ tuần 45, NV tuần 46 (Mr Bình).docx", w45)
        with mock.patch("documents.weekly_report_drive._drive_service", return_value=self.drive):
            response = self.client.post(f"/api/documents/weekly-reports/{self.own.pk}/drive", **self.headers)

        self.assertEqual(response.status_code, 409)
        self.assertIn("không ghi đè", response.json()["error"])
        self.assertEqual(self.drive.names_in(w45), ["5. BC KQ tuần 45, NV tuần 46 (Mr Bình).docx"])

    def test_employee_cannot_save_another_employees_report(self):
        with mock.patch("documents.weekly_report_drive._drive_service", return_value=self.drive):
            response = self.client.post(f"/api/documents/weekly-reports/{self.other.pk}/drive", **self.headers)
        self.assertEqual(response.status_code, 404)


class AiWritesBackToDriveTests(TestCase):
    def setUp(self):
        self.user = _profile("binh@fermat.vn", "Lê Văn Bình")
        WorkItem.objects.create(
            creator=self.user, executor=self.user, title="Làm slide cho Trường A",
            work_date=date(2026, 11, 3), status=WorkItem.STATUS_COMPLETED,
        )
        self.report = build_schedule_reports(report_week_start=date(2026, 11, 2), employee_email="binh@fermat.vn")[0]
        self.ai_output = json.dumps({
            "completedGroups": [{"name": "Triển khai tại trường", "items": ["Hoàn thiện slide cho Trường A ngày 03/11."]}],
            "difficulties": [],
            "plannedGroups": [{"name": "Triển khai tại trường", "items": ["Làm việc với Trường A, xong trong ngày 10/11."]}],
        }, ensure_ascii=False)

    def _run(self, save_to_drive):
        job = AiReportJob.objects.create(user=self.user, report=self.report, save_to_drive=save_to_drive)
        with mock.patch("documents.ai_service.execute_ai_command", return_value=self.ai_output), \
                mock.patch("documents.weekly_report_drive.save_report_to_drive") as save:
            process_ai_job(job.pk)
        return save

    def test_friday_job_refreshes_the_drive_file_after_ai(self):
        save = self._run(True)
        save.assert_called_once()
        self.assertEqual(save.call_args.args[0].pk, self.report.pk)

    def test_manual_rewrite_does_not_touch_drive(self):
        self._run(False).assert_not_called()


class RicherDraftAndPromptTests(TestCase):
    def setUp(self):
        self.user = _profile("binh@fermat.vn", "Lê Văn Bình")
        self.boss = _profile("thuan@fermat.vn", "Lê Đức Thuận")
        self.helper = _profile("tien@fermat.vn", "Trần Hoàng Minh Tiến")

    def test_prompt_carries_description_people_and_dates_but_not_import_marker(self):
        item = WorkItem.objects.create(
            creator=self.boss, executor=self.user, title="Làm slide giới thiệu BNDC",
            description="Gửi bản dự thảo cho Ban Dự án phường Ngọc Hà", work_date=date(2026, 11, 3),
            status=WorkItem.STATUS_COMPLETED, start_time=time(9, 0),
        )
        item.supporters.add(self.helper)
        WorkItem.objects.create(
            creator=self.user, executor=self.user, title="Nhắc đối tác gửi báo giá",
            description="Nhập từ Lịch công tác FT 2026 mới.", work_date=date(2026, 11, 4),
            status=WorkItem.STATUS_COMPLETED,
        )
        report = build_schedule_reports(report_week_start=date(2026, 11, 2), employee_email="binh@fermat.vn")[0]

        prompt = build_ai_report_prompt(report)

        self.assertIn("[Người giao: Lê Đức Thuận]", prompt)
        self.assertIn("[Phối hợp: Trần Hoàng Minh Tiến]", prompt)
        self.assertIn("[Mô tả: Gửi bản dự thảo cho Ban Dự án phường Ngọc Hà]", prompt)
        self.assertNotIn("Nhập từ Lịch công tác", prompt)
        self.assertIn("Tuần 45 (02/11–08/11/2026)", prompt)
        self.assertIn("Tuần 46 (09/11–15/11/2026)", prompt)
        self.assertNotIn("28 dòng", prompt)

    def test_week_dates_cross_the_new_year(self):
        report = WeeklyReport.objects.create(
            report_key="53-1-binh", employee_email="binh@fermat.vn", employee_name="Lê Văn Bình",
            completed_week=53, planned_week=1,
        )
        WeeklyReport.objects.filter(pk=report.pk).update(
            created_at=timezone.make_aware(datetime(2027, 1, 2, 10, 0)),
        )
        report.refresh_from_db()
        self.assertEqual(report_week_dates(report), (date(2026, 12, 28), date(2027, 1, 4)))


class DriveAccessGuardTests(TestCase):
    def test_no_visible_week_folder_stops_without_creating_duplicates(self):
        _profile("binh@fermat.vn", "Lê Văn Bình")
        drive = FakeDrive()  # what an account without access sees: nothing
        report = WeeklyReport.objects.create(
            report_key="45-46-binh", employee_email="binh@fermat.vn", employee_name="Lê Văn Bình",
            completed_week=45, planned_week=46, completed_items=["Hoàn thành slide"],
        )
        with mock.patch.dict("os.environ", {"WEEKLY_REPORT_DRIVE_FOLDER_ID": PARENT}):
            with self.assertRaises(PermissionError):
                save_report_to_drive(report, service=drive)
            with self.assertRaises(PermissionError):
                archive_week_reports(45, service=drive)
        self.assertEqual(drive.creates, 0)
