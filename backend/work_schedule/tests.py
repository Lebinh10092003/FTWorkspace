import os
from datetime import date, time, timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token

from authentication.models import UserProfile

from .models import WorkItem, WorkScheduleSheetChange, WorkScheduleSheetInboundEvent, WorkScheduleSheetSyncLease
from .sheet_parser import leader_assessment_notes, parse_leader_review, assessment_notes, parse_sheet_tasks, status_from_note, training_end
from .retention import notification_from, retained_from
from .sheet_sync import (
    EMPLOYEE_EMAILS,
    _build_content_format_runs,
    _attendance_value,
    _canonical_row,
    _formula_content_rows,
    _group_values,
    _row_hash,
    _row_employee_email,
    _sheet_columns,
    _unique_sheet_tasks,
    deterministic_sheet_uid,
    ensure_sheet_row_capacity,
    pull_from_sheet,
    sync_lease,
)
from .training_sync import sync_work_item_from_training


class WorkScheduleSheetParserTests(TestCase):
    def test_leader_notes_use_only_explicit_task_numbers(self):
        self.assertEqual(leader_assessment_notes("2. Tốt\nChi tiết\n9. Ngoài phạm vi", 3), ["", "Tốt\nChi tiết", ""])
        self.assertEqual(leader_assessment_notes("3: Đạt\n1 Hoàn thành", 3), ["Hoàn thành", "", "Đạt"])
        self.assertEqual(leader_assessment_notes("Hoàn thành", 3), ["Hoàn thành"] * 3)
        self.assertEqual(parse_leader_review("80% · Cần bổ sung"), (80, "Cần bổ sung"))
        with self.assertRaises(ValueError):
            parse_leader_review("101%")

    def test_support_tag_preserves_authored_times_and_sheet_formatting(self):
        raw = "1. [Hỗ trợ] 17h00: Hỗ trợ tập huấn buổi 3 MN Từ Liêm 2\n2. [Hỗ trợ] 8h00 - 10h30: Hỗ trợ tập huấn TH & THCS Lý Thường Kiệt, Buổi 1"
        tasks = parse_sheet_tasks(raw)
        self.assertEqual(tasks[0].start_time, time(17))
        self.assertEqual(tasks[1].start_time, time(8))
        self.assertEqual(tasks[1].end_time, time(10, 30))
        self.assertTrue(all(task.has_time_prefix for task in tasks))
        self.assertTrue(tasks[0].title.startswith("[Hỗ trợ]"))
        self.assertTrue(_build_content_format_runs(raw)[0]["format"]["bold"])

    def test_rolling_history_and_notification_windows(self):
        today = date(2026, 9, 10)
        self.assertEqual(retained_from(today), date(2026, 7, 1))
        self.assertEqual(notification_from(today), date(2026, 9, 1))

    def test_attendance_value_uses_the_visible_multiline_format(self):
        class Shift:
            def __init__(self, mode, start, end, day_off=False):
                self.work_mode = mode
                self.shift_start = start
                self.shift_end = end
                self.is_day_off = day_off

        self.assertEqual(
            _attendance_value([
                Shift("direct", time(9, 30), time(12, 0)),
                Shift("direct", time(13, 30), time(18, 0)),
                Shift("online", time(20, 0), time(23, 0)),
            ]),
            "Trực tiếp: 09:30 - 12:00\nTrực tiếp: 13:30 - 18:00\nOnline: 20:00 - 23:00",
        )
        self.assertEqual(_attendance_value([Shift("direct", time(0), time(0), True)]), "")

    def test_attendance_column_does_not_shift_assessment_or_hidden_metadata(self):
        columns = {
            "weekday": 0, "date": 1, "week": 2, "staff": 3,
            "content": 4, "self_notes": 5, "attendance": 6,
            "leader_notes": 7, "employee_id": 8, "task_ids": 9,
            "sync_hash": 10, "record_id": 11,
        }
        physical = [
            "Tư", "09/09/2026", "37", "1. Thuận", "1. Công việc",
            "Hoàn thành", "Có mặt", "Lãnh đạo duyệt", "EMP-1",
            "1. task-id", "hash", "REC-WEB-1",
        ]

        canonical = _canonical_row(physical, columns)

        self.assertEqual(canonical[4], "1. Công việc")
        self.assertEqual(canonical[5], "Hoàn thành")
        self.assertEqual(canonical[6], "Lãnh đạo duyệt")
        self.assertEqual(canonical[7:], ["EMP-1", "REC-WEB-1", "1. task-id", "hash"])

    def test_abbreviated_leader_header_and_moved_attendance_column_are_supported(self):
        service = mock.MagicMock()
        service.spreadsheets.return_value.values.return_value.get.return_value.execute.return_value = {
            "values": [[
                "Thứ", "Ngày", "Tuần", "Chủ trì", "Nội dung công việc",
                "Chấm công", "Tự đánh giá", "LĐ đánh giá", "EmployeeID",
                "WEB_TASK_IDS", "WEB_SYNC_HASH", "WEB_SYNC_HASH", "WEB_RECORD_ID",
            ]]
        }

        columns, _ = _sheet_columns(service)

        self.assertEqual(columns["attendance"], 5)
        self.assertEqual(columns["self_notes"], 6)
        self.assertEqual(columns["leader_notes"], 7)
        self.assertEqual(columns["task_ids"], 9)
        self.assertEqual(columns["sync_hash"], 10)
        self.assertEqual(columns["record_id"], 12)

    def test_sheet_mapping_includes_director_thuan(self):
        self.assertEqual(EMPLOYEE_EMAILS["EMP-E6557326"], "thuanld@fermat.edu.vn")
        self.assertEqual(
            _row_employee_email(["", "09/09/2026", "37", "1. Thuận", "Nội dung", "", "", "#REF!"]),
            "thuanld@fermat.edu.vn",
        )

    def test_staff_name_takes_priority_over_legacy_employee_id(self):
        self.assertEqual(
            _row_employee_email([
                "", "09/09/2026", "37", "9. Sơn", "Nội dung", "", "",
                "EMP-E6557326",
            ]),
            "sondc@fermat.edu.vn",
        )

    def test_ambiguous_short_name_requires_disambiguated_full_name(self):
        UserProfile.objects.create(
            email="liennt@fermat.edu.vn", name="Ngô Thị Liên",
            role="EMPLOYEE", employment_status="ACTIVE", access_modules=[],
        )
        UserProfile.objects.create(
            email="lien.other@example.com", name="Trần Mỹ Liên",
            role="EMPLOYEE", employment_status="ACTIVE", access_modules=[],
        )

        self.assertIsNone(_row_employee_email([
            "", "09/09/2026", "37", "Liên", "Nội dung", "", "", "",
        ]))
        self.assertEqual(
            _row_employee_email([
                "", "09/09/2026", "37", "Ngô Thị Liên", "Nội dung", "", "", "",
            ]),
            "liennt@fermat.edu.vn",
        )

    def test_sheet_identity_and_hash_are_stable_when_title_is_not_the_identity(self):
        self.assertEqual(str(deterministic_sheet_uid(1094, 1)), "6ae71379-0000-5000-8000-000446000001")
        self.assertEqual(_row_hash("a", "b", "c", "d"), "eb564109")

    def test_sheet_output_omits_open_statuses_and_empty_leader_reviews(self):
        class Item:
            def __init__(self, status, note="", review_percent=None):
                self.title = status
                self.start_time = None
                self.status = status
                self.progress_note = note
                self.review_percent = review_percent
                self.review_note = ""
                self.sync_uid = deterministic_sheet_uid(1094, 1 if status == "todo" else 2)

        _, self_notes, leader_notes, _ = _group_values([
            Item("todo"), Item("doing"), Item("completed"), Item("doing", "Đang chờ khách phản hồi")
        ])
        self.assertEqual(self_notes, "3. Hoàn thành\n4. Đang chờ khách phản hồi")
        self.assertEqual(leader_notes, "")

        _, completed_notes, leader_notes, _ = _group_values([
            Item("completed"), Item("reviewed")
        ])
        self.assertEqual(completed_notes, "Hoàn thành")
        self.assertEqual(leader_notes, "2. Hoàn thành")

        _, _, all_reviewed_notes, _ = _group_values([
            Item("reviewed"), Item("reviewed", review_percent=90)
        ])
        self.assertEqual(all_reviewed_notes, "1. Hoàn thành\n2. 90%")

    def test_sheet_output_keeps_web_grid_title_verbatim(self):
        class Item:
            title = "7h30 - 12h30 Tham gia tập huấn TH Kim Đồng"
            start_time = time(7, 30)
            status = "todo"
            progress_note = ""
            review_percent = None
            review_note = ""
            sync_uid = deterministic_sheet_uid(1148, 1)

        content, _, _, _ = _group_values([Item()])

        self.assertEqual(content, "1. 7h30 - 12h30 Tham gia tập huấn TH Kim Đồng")

    def test_numbered_cell_keeps_wrapped_lines_and_accepts_duplicate_numbers(self):
        tasks = parse_sheet_tasks(
            "1. Nhiệm vụ đầu\nphần mô tả xuống dòng\n2. Nhiệm vụ hai\n2. 17h30: Tập huấn GCE1"
        )
        self.assertEqual([task.title for task in tasks], [
            "Nhiệm vụ đầu\nphần mô tả xuống dòng",
            "Nhiệm vụ hai",
            "17h30: Tập huấn GCE1",
        ])
        self.assertEqual(tasks[-1].start_time.isoformat(timespec="minutes"), "17:30")
        self.assertEqual(training_end(tasks[-1].start_time).isoformat(timespec="minutes"), "20:30")

    def test_time_prefix_accepts_vietnamese_hour_notation_and_plain_hour(self):
        tasks = parse_sheet_tasks(
            "1. 8h30: Việc một\n2. 8h Việc hai\n3. 7h00 - Việc ba\n4. 7:00 Việc bốn"
        )
        self.assertEqual(
            [task.start_time.isoformat(timespec="minutes") for task in tasks],
            ["08:30", "08:00", "07:00", "07:00"],
        )
        self.assertTrue(all(task.has_time_prefix for task in tasks))

    def test_time_range_is_preserved_verbatim_and_parsed_as_metadata(self):
        task = parse_sheet_tasks("1. 7h30 - 12h30 Tham gia tập huấn TH Kim Đồng")[0]

        self.assertEqual(task.title, "7h30 - 12h30 Tham gia tập huấn TH Kim Đồng")
        self.assertEqual(task.start_time.isoformat(timespec="minutes"), "07:30")
        self.assertEqual(task.end_time.isoformat(timespec="minutes"), "12:30")

    def test_only_authored_time_prefix_gets_bold_italic_pure_black(self):
        self.assertEqual(_build_content_format_runs(""), [])

        content = "1. Việc có giờ hệ thống\n2. 8h30: Việc ghi giờ trong tên\n3. 7:00 Việc khác"
        runs = _build_content_format_runs(content)
        emphasized = [run for run in runs if run["format"].get("bold")]
        self.assertEqual(len(emphasized), 1)
        self.assertEqual(
            emphasized[0]["format"]["foregroundColorStyle"]["rgbColor"],
            {"red": 0.0, "green": 0.0, "blue": 0.0},
        )

        class Item:
            def __init__(self, priority):
                self.priority = priority

        priority_runs = _build_content_format_runs(
            "1. Việc không có giờ nhưng ưu tiên cao\n2. Việc thường",
            [Item("high"), Item("medium")],
        )
        self.assertTrue(priority_runs[0]["format"]["bold"])
        self.assertEqual(priority_runs[1]["format"], {})

    def test_future_roster_row_resolves_employee_without_hidden_id(self):
        from work_schedule.sheet_sync import _row_employee_email

        self.assertEqual(
            _row_employee_email(["Hai", "14/09/2026", "38", "6. Phong"]),
            "phongnt@fermat.edu.vn",
        )

    def test_new_employee_resolves_dynamically_by_code_or_unique_roster_name(self):
        from work_schedule.sheet_sync import _row_employee_email, _sheet_employee_code

        profile = UserProfile.objects.create(
            email="new.an@fermat.edu.vn",
            name="Nguyễn Văn An",
            employee_code="FT-NEW-AN",
            employment_status="ACTIVE",
        )
        self.assertEqual(
            _row_employee_email(["Hai", "14/09/2026", "38", "11. An"]),
            profile.email,
        )
        self.assertEqual(
            _row_employee_email(["Hai", "14/09/2026", "38", "11. An", "", "", "", "FT-NEW-AN"]),
            profile.email,
        )
        self.assertEqual(_sheet_employee_code(profile.email), "FT-NEW-AN")

        no_code = UserProfile.objects.create(
            email="new.no-code@fermat.edu.vn",
            name="Nhân sự chưa có mã",
            employment_status="ACTIVE",
        )
        self.assertEqual(_sheet_employee_code(no_code.email), no_code.email)

    def test_identical_tasks_in_one_sheet_cell_are_collapsed(self):
        tasks = _unique_sheet_tasks(parse_sheet_tasks(
            "1. Tập huấn B3, B4 TH Kim Đồng\n"
            "2. 08:30: Tập huấn B3, B4 TH Kim Đồng\n"
            "3. Chuẩn bị tài liệu"
        ))

        self.assertEqual([task.title for task in tasks], [
            "08:30: Tập huấn B3, B4 TH Kim Đồng",
            "Chuẩn bị tài liệu",
        ])
        self.assertEqual(tasks[0].start_time.isoformat(timespec="minutes"), "08:30")

    def test_apps_script_utc_date_is_converted_to_the_local_sheet_date(self):
        from .sheet_sync import _parse_date

        self.assertEqual(_parse_date("2026-09-08T17:00:00.000Z").isoformat(), "2026-09-09")

    def test_assessment_is_aligned_by_occurrence_and_custom_note_does_not_complete(self):
        notes = assessment_notes("1. Đang chờ ký\n2. Hoàn thành", 3)
        self.assertEqual(notes, ["Đang chờ ký", "Hoàn thành", ""])
        self.assertEqual(status_from_note(notes[0], False), "doing")
        self.assertEqual(status_from_note(notes[1], False), "completed")
        self.assertEqual(status_from_note("", True), "todo")
        self.assertEqual(assessment_notes("2. Hoàn thành", 3), ["", "Hoàn thành", ""])


class WorkScheduleApiTests(TestCase):
    def profile(self, email, role="EMPLOYEE"):
        user = get_user_model().objects.create_user(username=email, email=email, password="StrongPassword9921")
        profile = UserProfile.objects.create(email=email, name=email.split("@", 1)[0], role=role, access_modules=[])
        return profile, Token.objects.create(user=user).key

    def request(self, token, method, path, payload=None):
        return getattr(self.client, method)(
            path, payload or {}, content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {token}"
        )

    def setUp(self):
        self.executor, self.executor_token = self.profile("executor@example.com")
        self.supporter, self.supporter_token = self.profile("supporter@example.com")
        self.manager, self.manager_token = self.profile("manager@example.com", "MANAGER")

    def create_item(self):
        response = self.request(self.manager_token, "post", "/api/work-schedule/items", {
            "title": "Hoàn thiện báo cáo",
            "date": "2026-09-07",
            "executorEmail": self.executor.email,
            "supporterEmails": [self.supporter.email],
            "managerEmails": [self.manager.email],
            "priority": "high",
        })
        self.assertEqual(response.status_code, 201, response.data)
        return response.json()["item"]

    def test_item_is_visible_with_relationship_specific_titles(self):
        item = self.create_item()
        executor = self.request(self.executor_token, "get", "/api/work-schedule/items").json()["items"][0]
        supporter = self.request(self.supporter_token, "get", "/api/work-schedule/items").json()["items"][0]
        manager = self.request(self.manager_token, "get", "/api/work-schedule/items").json()["items"][0]
        self.assertEqual(executor["displayTitle"], "Hoàn thiện báo cáo")
        self.assertEqual(supporter["displayTitle"], "Hỗ trợ/theo dõi: Hoàn thiện báo cáo")
        self.assertEqual(manager["displayTitle"], "Quản lý: Hoàn thiện báo cáo")
        self.assertEqual(item["executor"]["email"], self.executor.email)

    def test_manager_revision_keeps_completed_item_and_creates_next_day_item(self):
        item = self.create_item()
        completed = self.request(self.executor_token, "patch", f"/api/work-schedule/items/{item['id']}", {
            "title": item["title"], "date": item["date"], "executorEmail": self.executor.email,
            "supporterEmails": [self.supporter.email], "managerEmails": [self.manager.email], "status": "completed",
        })
        self.assertEqual(completed.status_code, 200, completed.data)
        manager_view = self.request(self.manager_token, "get", "/api/work-schedule/items").json()["items"][0]
        self.assertEqual(manager_view["displayStatus"], "todo")
        self.assertTrue(manager_view["displayTitle"].startswith("Kiểm tra kết quả công việc:"))

        revise = self.request(self.manager_token, "post", f"/api/work-schedule/items/{item['id']}/review", {
            "action": "request_revision", "reviewPercent": 70, "reviewNote": "Bổ sung số liệu",
        })
        self.assertEqual(revise.status_code, 200, revise.data)
        rows = self.request(self.executor_token, "get", "/api/work-schedule/items").json()["items"]
        original = next(row for row in rows if row["id"] == item["id"])
        revision = next(row for row in rows if row["id"] != item["id"])
        self.assertEqual(original["status"], "completed")
        self.assertEqual(original["date"], "2026-09-07")
        self.assertFalse(original["canEdit"])
        self.assertFalse(original["canReview"])
        self.assertEqual(revision["status"], "doing")
        self.assertEqual(revision["date"], "2026-09-08")
        self.assertEqual(revision["revisionOfId"], item["id"])
        self.assertTrue(revision["displayTitle"].startswith("Bổ sung:"))

        WorkItem.objects.filter(pk=revision["id"]).update(status="completed")
        confirm = self.request(self.manager_token, "post", f"/api/work-schedule/items/{revision['id']}/review", {
            "action": "confirm", "reviewPercent": 100,
        })
        self.assertEqual(confirm.status_code, 200, confirm.data)
        self.assertEqual(confirm.json()["item"]["status"], "reviewed")

    def test_items_are_numbered_per_executor_and_date_and_renumber_after_move(self):
        first = self.create_item()
        second = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Việc thứ hai", "date": "2026-09-07", "executorEmail": self.executor.email,
            "supporterEmails": [], "managerEmails": [],
        }).json()["item"]
        self.assertEqual(first["dailyOrder"], 1)
        self.assertEqual(second["dailyOrder"], 2)

        moved = self.request(self.executor_token, "patch", f"/api/work-schedule/items/{first['id']}", {
            "title": first["title"], "date": "2026-09-08", "executorEmail": self.executor.email,
            "supporterEmails": [self.supporter.email], "managerEmails": [self.manager.email], "status": "todo",
        })
        self.assertEqual(moved.status_code, 200, moved.data)
        self.assertEqual(moved.json()["item"]["dailyOrder"], 1)
        self.assertEqual(WorkItem.objects.get(pk=second["id"]).daily_order, 1)

    def test_web_changes_are_added_to_sheet_outbox(self):
        self.create_item()
        self.assertTrue(WorkScheduleSheetChange.objects.filter(
            executor_email=self.executor.email,
            work_date="2026-09-07",
            status=WorkScheduleSheetChange.STATUS_PENDING,
        ).exists())

    def test_delete_requires_no_password_and_batch_status_is_supported(self):
        first = self.create_item()
        second = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Việc cá nhân", "date": "2026-09-07", "executorEmail": self.executor.email,
            "supporterEmails": [], "managerEmails": [],
        }).json()["item"]
        batch = self.request(self.executor_token, "post", "/api/work-schedule/items/batch", {
            "ids": [second["id"]], "action": "status", "status": "doing",
        })
        self.assertEqual(batch.status_code, 200, batch.data)
        self.assertEqual(WorkItem.objects.get(pk=second["id"]).status, "doing")
        deleted = self.request(self.manager_token, "delete", f"/api/work-schedule/items/{first['id']}")
        self.assertEqual(deleted.status_code, 200, deleted.data)
        self.assertFalse(WorkItem.objects.filter(pk=first["id"]).exists())

    def test_executor_can_delete_work_assigned_by_manager(self):
        item = self.create_item()
        executor_view = self.request(
            self.executor_token, "get", f"/api/work-schedule/items/{item['id']}"
        ).json()
        self.assertTrue(executor_view["canDelete"])

        deleted = self.request(
            self.executor_token, "delete", f"/api/work-schedule/items/{item['id']}"
        )
        self.assertEqual(deleted.status_code, 200, deleted.data)
        self.assertFalse(WorkItem.objects.filter(pk=item["id"]).exists())

    def test_executor_can_delete_manager_assigned_work_from_day_table(self):
        item = self.create_item()

        deleted = self.request(self.executor_token, "post", "/api/work-schedule/day", {
            "date": item["date"],
            "items": [],
            "deleteIds": [item["id"]],
        })

        self.assertEqual(deleted.status_code, 200, deleted.data)
        self.assertFalse(WorkItem.objects.filter(pk=item["id"]).exists())

    def test_executor_can_delete_manager_assigned_training_work_from_day_table(self):
        from digital_training.models import TrainingSession

        session = TrainingSession.objects.create(
            title="Tập huấn B3 TH Kim Đồng",
            session_date="2026-09-12",
            start_time=time(7, 30),
            end_time=time(12, 30),
            source=TrainingSession.SOURCE_WORK_SCHEDULE,
        )
        item = WorkItem.objects.create(
            creator=self.manager,
            executor=self.executor,
            title=session.title,
            work_date=session.session_date,
            training_session=session,
            daily_order=1,
        )
        item.managers.add(self.manager)

        deleted = self.request(self.executor_token, "post", "/api/work-schedule/day", {
            "date": str(item.work_date),
            "items": [],
            "deleteIds": [item.id],
        })

        self.assertEqual(deleted.status_code, 200, deleted.data)
        self.assertFalse(WorkItem.objects.filter(pk=item.id).exists())
        self.assertFalse(TrainingSession.objects.filter(pk=session.id).exists())

    def test_progress_note_can_be_updated_independently_in_any_status(self):
        item = self.create_item()
        WorkItem.objects.filter(pk=item["id"]).update(status="reviewed", reviewed_at=timezone.now())
        response = self.request(self.executor_token, "patch", f"/api/work-schedule/items/{item['id']}", {
            "progressNote": "Đang chờ Ms Phương xác nhận bản in",
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["item"]["progressNote"], "Đang chờ Ms Phương xác nhận bản in")

    def test_day_table_edit_keeps_status_and_creates_numbered_new_task(self):
        first = self.create_item()
        second = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Nhiệm vụ đã hoàn thành", "date": "2026-09-07",
            "executorEmail": self.executor.email, "supporterEmails": [], "managerEmails": [],
            "status": "completed",
        }).json()["item"]

        response = self.request(self.executor_token, "post", "/api/work-schedule/day", {
            "date": "2026-09-07",
            "items": [
                {"id": first["id"], "title": "Hoàn thiện báo cáo đã sửa", "progressNote": "Đang chờ duyệt"},
                {"id": second["id"], "title": second["title"], "progressNote": "Đã gửi bản chính"},
                {"title": "Nhiệm vụ nhập từ dòng số 3", "progressNote": ""},
            ],
        })
        self.assertEqual(response.status_code, 200, response.data)
        first_row = WorkItem.objects.get(pk=first["id"])
        second_row = WorkItem.objects.get(pk=second["id"])
        new_row = WorkItem.objects.get(title="Nhiệm vụ nhập từ dòng số 3", executor=self.executor)
        self.assertEqual(first_row.status, "todo")
        self.assertEqual(first_row.progress_note, "Đang chờ duyệt")
        self.assertEqual(second_row.status, "completed")
        self.assertEqual(second_row.progress_note, "Đã gửi bản chính")
        self.assertEqual(new_row.status, "todo")
        self.assertEqual(new_row.executor, self.executor)
        self.assertEqual(new_row.daily_order, 3)

    def test_day_table_edit_can_confirm_completion_directly(self):
        item = self.create_item()
        response = self.request(self.executor_token, "post", "/api/work-schedule/day", {
            "date": item["date"],
            "items": [{
                "id": item["id"],
                "title": item["title"],
                "progressNote": "Hoàn thành",
                "status": "completed",
            }],
        })
        self.assertEqual(response.status_code, 200, response.data)
        updated = WorkItem.objects.get(pk=item["id"])
        self.assertEqual(updated.status, "completed")
        self.assertEqual(updated.progress_note, "Hoàn thành")

    def test_manager_can_review_all_completed_tasks_once_for_the_day(self):
        self.executor.manager = self.manager
        self.executor.save(update_fields=["manager"])
        first = self.create_item()
        second = self.request(self.manager_token, "post", "/api/work-schedule/items", {
            "title": "Nhiệm vụ thứ hai", "date": first["date"],
            "executorEmail": self.executor.email, "supporterEmails": [],
            "managerEmails": [self.manager.email], "status": "completed",
        }).json()["item"]
        WorkItem.objects.filter(pk=first["id"]).update(status="completed")

        response = self.request(self.manager_token, "post", "/api/work-schedule/day", {
            "date": first["date"],
            "executorEmail": self.executor.email,
            "leaderAssessment": "Hoàn thành",
            "items": [
                {"id": first["id"], "title": first["title"], "progressNote": "Hoàn thành", "status": "completed", "dailyOrder": 1},
                {"id": second["id"], "title": second["title"], "progressNote": "Hoàn thành", "status": "completed", "dailyOrder": 2},
            ],
        })

        self.assertEqual(response.status_code, 200, response.data)
        reviewed = WorkItem.objects.filter(pk__in=[first["id"], second["id"]])
        self.assertEqual(reviewed.filter(status="reviewed", review_percent=100, reviewed_by=self.manager).count(), 2)

    def test_manager_reviews_only_the_numbered_task_and_preserves_note(self):
        self.executor.manager = self.manager
        self.executor.save(update_fields=["manager"])
        first = self.create_item()
        second = self.request(self.manager_token, "post", "/api/work-schedule/items", {
            "title": "Nhiệm vụ thứ hai", "date": first["date"],
            "executorEmail": self.executor.email, "managerEmails": [self.manager.email],
        }).json()["item"]
        response = self.request(self.manager_token, "post", "/api/work-schedule/day", {
            "date": first["date"], "executorEmail": self.executor.email,
            "leaderAssessment": "2. Kết quả tốt",
            "items": [
                {"id": first["id"], "title": first["title"], "dailyOrder": 1},
                {"id": second["id"], "title": second["title"], "dailyOrder": 2},
            ],
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(WorkItem.objects.get(pk=first["id"]).status, "todo")
        reviewed = WorkItem.objects.get(pk=second["id"])
        self.assertEqual(reviewed.status, "reviewed")
        self.assertEqual(reviewed.review_note, "Kết quả tốt")
        self.assertEqual(_group_values(list(WorkItem.objects.filter(pk__in=[first["id"], second["id"]]).order_by("daily_order")))[2], "2. Kết quả tốt")

    def test_day_review_completion_confirms_unfinished_tasks(self):
        self.executor.manager = self.manager
        self.executor.save(update_fields=["manager"])
        item = self.create_item()
        response = self.request(self.manager_token, "post", "/api/work-schedule/day", {
            "date": item["date"],
            "executorEmail": self.executor.email,
            "leaderAssessment": "Hoàn thành",
            "items": [{"id": item["id"], "title": item["title"], "progressNote": "", "status": "todo", "dailyOrder": 1}],
        })

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(WorkItem.objects.get(pk=item["id"]).status, "reviewed")

    def test_day_table_edit_can_delete_a_removed_numbered_task(self):
        first = self.create_item()
        second = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Nhiệm vụ cần xóa", "date": first["date"],
            "executorEmail": self.executor.email, "supporterEmails": [], "managerEmails": [],
        }).json()["item"]
        response = self.request(self.executor_token, "post", "/api/work-schedule/day", {
            "date": first["date"],
            "items": [{"id": first["id"], "title": first["title"], "progressNote": ""}],
            "deleteIds": [second["id"]],
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(WorkItem.objects.filter(pk=second["id"]).exists())
        self.assertEqual(WorkItem.objects.get(pk=first["id"]).daily_order, 1)

    def test_day_table_edit_updates_number_order_for_drag_views(self):
        first = self.create_item()
        second = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Nhiệm vụ thứ hai", "date": first["date"],
            "executorEmail": self.executor.email, "supporterEmails": [], "managerEmails": [],
        }).json()["item"]
        response = self.request(self.executor_token, "post", "/api/work-schedule/day", {
            "date": first["date"],
            "executorEmail": self.executor.email,
            "items": [
                {"id": first["id"], "title": first["title"], "progressNote": "", "dailyOrder": 2},
                {"id": second["id"], "title": second["title"], "progressNote": "", "dailyOrder": 1},
            ],
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(WorkItem.objects.get(pk=first["id"]).daily_order, 2)
        self.assertEqual(WorkItem.objects.get(pk=second["id"]).daily_order, 1)

    def test_direct_manager_can_edit_report_schedule_and_create_for_report(self):
        self.executor.manager = self.manager
        self.executor.save(update_fields=["manager"])
        existing = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Việc nhân viên tự tạo", "date": "2026-09-07",
            "executorEmail": self.executor.email, "supporterEmails": [], "managerEmails": [],
        }).json()["item"]
        response = self.request(self.manager_token, "post", "/api/work-schedule/day", {
            "date": "2026-09-07", "executorEmail": self.executor.email,
            "items": [
                {"id": existing["id"], "title": "Việc đã được quản lý sửa", "progressNote": "", "dailyOrder": 1},
                {"title": "Việc quản lý giao thêm", "progressNote": "", "dailyOrder": 2},
            ],
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(WorkItem.objects.filter(executor=self.executor, title="Việc đã được quản lý sửa").exists())
        created = WorkItem.objects.get(executor=self.executor, title="Việc quản lý giao thêm")
        self.assertTrue(created.managers.filter(pk=self.manager.pk).exists())

    def test_day_table_rejects_duplicate_or_out_of_range_numbers(self):
        first = self.create_item()
        duplicate = self.request(self.executor_token, "post", "/api/work-schedule/day", {
            "date": first["date"], "executorEmail": self.executor.email,
            "items": [
                {"id": first["id"], "title": first["title"], "progressNote": "", "dailyOrder": 1},
                {"title": "Trùng số", "progressNote": "", "dailyOrder": 1},
            ],
        })
        self.assertEqual(duplicate.status_code, 400, duplicate.data)
        invalid = self.request(self.executor_token, "post", "/api/work-schedule/day", {
            "date": first["date"], "executorEmail": self.executor.email,
            "items": [{"id": first["id"], "title": first["title"], "progressNote": "", "dailyOrder": 101}],
        })
        self.assertEqual(invalid.status_code, 400, invalid.data)


    def test_batch_date_and_people_assignment_are_supported(self):
        first = self.create_item()
        second = self.request(self.manager_token, "post", "/api/work-schedule/items", {
            "title": "Việc thứ hai", "date": "2026-09-07", "executorEmail": self.executor.email,
            "supporterEmails": [], "managerEmails": [self.manager.email],
        }).json()["item"]
        moved = self.request(self.manager_token, "post", "/api/work-schedule/items/batch", {
            "ids": [first["id"], second["id"]], "action": "date", "date": "2026-09-09",
        })
        self.assertEqual(moved.status_code, 200, moved.data)
        self.assertFalse(WorkItem.objects.filter(id__in=[first["id"], second["id"]]).exclude(work_date="2026-09-09").exists())

        observer, _ = self.profile("observer@example.com")
        assigned = self.request(self.manager_token, "post", "/api/work-schedule/items/batch", {
            "ids": [first["id"], second["id"]], "action": "add_supporters", "emails": [observer.email],
        })
        self.assertEqual(assigned.status_code, 200, assigned.data)
        self.assertEqual(WorkItem.objects.filter(id__in=[first["id"], second["id"]], supporters=observer).count(), 2)

        added_manager = self.request(self.executor_token, "post", "/api/work-schedule/items/batch", {
            "ids": [first["id"], second["id"]], "action": "add_managers", "emails": [observer.email],
        })
        self.assertEqual(added_manager.status_code, 200, added_manager.data)
        self.assertEqual(WorkItem.objects.filter(id__in=[first["id"], second["id"]], managers=observer).count(), 2)

    def test_manager_can_assign_one_task_to_multiple_direct_reports_atomically(self):
        second_executor, _ = self.profile("second-executor@example.com")
        self.executor.manager = self.manager
        self.executor.save(update_fields=["manager"])
        second_executor.manager = self.manager
        second_executor.save(update_fields=["manager"])

        response = self.request(self.manager_token, "post", "/api/work-schedule/items", {
            "title": "Chuẩn bị tài liệu chung",
            "date": "2026-09-10",
            "executorEmails": [self.executor.email, second_executor.email],
            "supporterEmails": [],
            "managerEmails": [],
        })

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(response.json()["items"]), 2)
        created = WorkItem.objects.filter(title="Chuẩn bị tài liệu chung").order_by("executor_id")
        self.assertEqual(created.count(), 2)
        self.assertTrue(all(not item.managers.exists() for item in created))
        employee_rows = self.request(self.executor_token, "get", "/api/work-schedule/items").json()["items"]
        self.assertIn(self.executor.email, [row["executor"]["email"] for row in employee_rows if row["title"] == "Chuẩn bị tài liệu chung"])

        defaulted = self.request(self.manager_token, "post", "/api/work-schedule/items", {
            "title": "Việc dùng người giao mặc định", "date": "2026-09-10",
            "executorEmails": [self.executor.email], "supporterEmails": [],
        })
        self.assertEqual(defaulted.status_code, 201, defaulted.data)
        self.assertTrue(WorkItem.objects.get(title="Việc dùng người giao mặc định").managers.filter(email=self.manager.email).exists())

        outsider, _ = self.profile("outsider@example.com")
        rejected = self.request(self.manager_token, "post", "/api/work-schedule/items", {
            "title": "Không được tạo dở dang",
            "date": "2026-09-10",
            "executorEmails": [self.executor.email, outsider.email],
            "supporterEmails": [],
            "managerEmails": [],
        })
        self.assertEqual(rejected.status_code, 403, rejected.data)
        self.assertFalse(WorkItem.objects.filter(title="Không được tạo dở dang").exists())

    @override_settings(WORK_SCHEDULE_TRAINING_PROJECTION_ENABLED=True)
    def test_training_schedule_syncs_both_ways_with_three_hour_duration(self):
        response = self.request(self.manager_token, "post", "/api/work-schedule/items", {
            "title": "Tập huấn B1 TH Trung Văn", "date": "2026-09-15",
            "startTime": "17:00", "executorEmail": self.executor.email,
            "supporterEmails": [self.supporter.email], "managerEmails": [self.manager.email],
            "label": "Tập huấn",
        })
        self.assertEqual(response.status_code, 201, response.data)
        item = WorkItem.objects.select_related("training_session").get(pk=response.json()["item"]["id"])
        self.assertIsNotNone(item.training_session_id)
        self.assertEqual(item.training_session.source, "work_schedule")
        self.assertEqual(item.end_time.isoformat(timespec="minutes"), "20:00")
        self.assertEqual(item.training_session.end_time.isoformat(timespec="minutes"), "20:00")

        session = item.training_session
        session.session_date = "2026-09-16"
        session.status = "completed"
        session.save()
        sync_work_item_from_training(session, self.manager)
        item.refresh_from_db()
        self.assertEqual(item.work_date.isoformat(), "2026-09-16")
        self.assertEqual(item.status, "completed")

    @override_settings(WORK_SCHEDULE_TRAINING_PROJECTION_ENABLED=True)
    def test_training_schedule_preserves_an_explicit_end_time_when_edited(self):
        from digital_training.models import TrainingSession

        session = TrainingSession.objects.create(
            title="Buổi 3 · TH Kim Đồng",
            session_date="2026-09-12",
            start_time=time(7, 30),
            end_time=time(10, 30),
            instructor_name=self.executor.name,
        )
        sync_work_item_from_training(session, self.manager)

        session.start_time = time(8, 15)
        session.end_time = time(11, 45)
        session.save(update_fields=["start_time", "end_time"])
        sync_work_item_from_training(session, self.manager)

        session.refresh_from_db()
        item = WorkItem.objects.get(training_session=session)
        self.assertEqual(session.start_time.isoformat(timespec="minutes"), "08:15")
        self.assertEqual(session.end_time.isoformat(timespec="minutes"), "11:45")
        self.assertEqual(item.start_time.isoformat(timespec="minutes"), "08:15")
        self.assertEqual(item.end_time.isoformat(timespec="minutes"), "11:45")

    def test_training_reference_inside_normal_task_does_not_create_session(self):
        response = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Gửi tài liệu sau tập huấn", "date": "2026-09-07",
            "executorEmail": self.executor.email, "supporterEmails": [], "managerEmails": [],
            "label": "Công việc",
        })
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(WorkItem.objects.get(pk=response.json()["item"]["id"]).training_session_id)

    def test_title_with_time_notation_is_preserved_verbatim(self):
        # The system must never reformat or strip text that users write as task titles.
        # Authored time remains verbatim in the title while also becoming
        # scheduling metadata and high priority.
        for raw_title, expected_start in [
            ("8h30: Họp triển khai", "08:30"),
            ("7:30 - 12:30", "07:30"),
            ("7h Họp nhóm", "07:00"),
        ]:
            with self.subTest(title=raw_title):
                response = self.request(self.executor_token, "post", "/api/work-schedule/items", {
                    "title": raw_title, "date": "2026-09-07",
                    "executorEmail": self.executor.email, "supporterEmails": [], "managerEmails": [],
                    "priority": "medium",
                })
                self.assertEqual(response.status_code, 201, response.data)
                item = WorkItem.objects.get(pk=response.json()["item"]["id"])
                self.assertEqual(item.title, raw_title)
                self.assertEqual(item.start_time.isoformat(timespec="minutes"), expected_start)
                self.assertEqual(item.priority, "high")
                self.assertTrue(item.time_prefix_in_title)
                item.delete()

    def test_direct_manager_can_edit_and_review_employee_authored_tasks(self):
        self.executor.manager = self.manager
        self.executor.save(update_fields=["manager"])
        item = WorkItem.objects.create(creator=self.executor, executor=self.executor,
                                      work_date=date(2026, 9, 15), title="Việc nhân viên nhập")
        response = self.request(self.manager_token, "get", "/api/work-schedule/team")
        task = next(row for row in response.data["items"] if row["id"] == item.pk)
        self.assertEqual(task["viewerRelation"], "team_viewer")
        self.assertTrue(task["canAssess"])
        response = self.request(self.manager_token, "post", "/api/work-schedule/day", {
            "date": "2026-09-15", "executorEmail": self.executor.email,
            "items": [{"id": item.pk, "title": "[Hỗ trợ] 8h00 - 10h30: Hỗ trợ tập huấn", "dailyOrder": 1}],
        })
        self.assertEqual(response.status_code, 200, response.data)
        item.refresh_from_db()
        self.assertEqual((item.start_time, item.end_time, item.priority), (time(8), time(10, 30), "high"))
        response = self.request(self.manager_token, "post", "/api/work-schedule/day", {
            "date": "2026-09-15", "executorEmail": self.executor.email,
            "items": [{"id": item.pk, "title": "[Hỗ trợ] Hỗ trợ tập huấn", "dailyOrder": 1}],
        })
        self.assertEqual(response.status_code, 200, response.data)
        item.refresh_from_db()
        self.assertEqual((item.start_time, item.end_time, item.priority, item.time_prefix_in_title), (None, None, "medium", False))

    def test_removing_authored_time_in_detail_clears_auto_priority(self):
        item = WorkItem.objects.create(creator=self.executor, executor=self.executor, work_date=date(2026, 9, 15),
                                      title="17h00: Việc quan trọng", start_time=time(17), priority="high", time_prefix_in_title=True)
        response = self.request(self.executor_token, "patch", f"/api/work-schedule/items/{item.pk}", {"title": "Việc không giờ"})
        self.assertEqual(response.status_code, 200, response.data)
        item.refresh_from_db()
        self.assertEqual((item.start_time, item.priority), (None, "medium"))

    def test_manual_high_priority_without_time_is_preserved(self):
        item = WorkItem.objects.create(creator=self.executor, executor=self.executor,
                                      work_date=date(2026, 9, 15), title="Quan trọng thủ công", priority="high")
        response = self.request(self.executor_token, "post", "/api/work-schedule/day", {
            "date": "2026-09-15", "items": [{"id": item.pk, "title": "[Hỗ trợ] Quan trọng thủ công", "dailyOrder": 1}],
        })
        self.assertEqual(response.status_code, 200, response.data)
        item.refresh_from_db()
        self.assertEqual(item.priority, "high")

    def test_manual_priority_is_restored_after_adding_and_removing_time(self):
        for priority in ["low", "medium", "high"]:
            item = WorkItem.objects.create(creator=self.executor, executor=self.executor,
                                          work_date=date(2026, 9, 15), title="Việc không giờ", priority=priority)
            for title, expected in [("[Hỗ trợ] 8h00: Việc có giờ", "high"), ("[Hỗ trợ] Việc không giờ", priority)]:
                response = self.request(self.executor_token, "post", "/api/work-schedule/day", {
                    "date": "2026-09-15", "items": [{"id": item.pk, "title": title, "dailyOrder": 1}],
                })
                self.assertEqual(response.status_code, 200, response.data)
                item.refresh_from_db()
                self.assertEqual(item.priority, expected)
            self.assertIsNone(item.priority_before_time)
            item.delete()

    def test_day_response_failure_rolls_back_saved_changes(self):
        item = WorkItem.objects.create(creator=self.executor, executor=self.executor,
                                      work_date=date(2026, 9, 15), title="Nội dung cũ")
        with mock.patch("work_schedule.views._payload", side_effect=[{"canEdit": True}, RuntimeError("response failed")]):
            with self.assertRaises(RuntimeError):
                self.request(self.executor_token, "post", "/api/work-schedule/day", {
                    "date": "2026-09-15", "items": [{"id": item.pk, "title": "Nội dung mới", "dailyOrder": 1}],
                })
        item.refresh_from_db()
        self.assertEqual(item.title, "Nội dung cũ")

    def test_unchanged_sheet_does_not_overwrite_unsent_manager_edit(self):
        from collections import defaultdict
        from .sheet_sync import _ingest_row
        item = WorkItem.objects.create(creator=self.executor, executor=self.executor,
                                      work_date=date(2026, 9, 15), title="Nội dung quản lý vừa sửa", source_sheet_row=5001)
        row = ["", "15/09/2026", "38", self.executor.email, "1. Nội dung cũ", "", "", self.executor.email, "REC-WEB-TEST", f"1. {item.sync_uid}"]
        row.append(_row_hash(row[4], row[5], row[6], row[9]))
        retained = defaultdict(set)
        with mock.patch("work_schedule.sheet_sync._row_employee_email", return_value=self.executor.email):
            counts = _ingest_row(5001, row, date(2026, 9, 15), retained_by_group=retained)
        self.assertEqual(counts[:3], (0, 0, 0))
        item.refresh_from_db()
        self.assertEqual(item.title, "Nội dung quản lý vừa sửa")
        self.assertIn(item.pk, retained[(self.executor.email, item.work_date)])
        # A pending web deletion must not be undone by the stale Sheet row.
        item.delete()
        with mock.patch("work_schedule.sheet_sync._row_employee_email", return_value=self.executor.email):
            _ingest_row(5001, row, date(2026, 9, 15))
        self.assertFalse(WorkItem.objects.filter(executor=self.executor, work_date="2026-09-15").exists())

    def test_grid_title_with_time_range_is_preserved_verbatim(self):
        # Users often write "7:30 - 12:30" (start–end) in the schedule grid. The
        # system must store this exactly; it must NOT split it into a start_time and
        # a stripped title ("12:30").
        response = self.request(self.executor_token, "post", "/api/work-schedule/day", {
            "date": "2026-09-07",
            "items": [{"title": "7:30 - 12:30", "progressNote": "", "dailyOrder": 1}],
        })
        self.assertEqual(response.status_code, 200, response.data)
        item = WorkItem.objects.get(executor=self.executor, work_date="2026-09-07", title="7:30 - 12:30")
        self.assertEqual(item.start_time.isoformat(timespec="minutes"), "07:30")
        self.assertEqual(item.end_time.isoformat(timespec="minutes"), "12:30")
        self.assertEqual(item.priority, "high")
        self.assertTrue(item.time_prefix_in_title)

    @override_settings(WORK_SCHEDULE_TRAINING_PROJECTION_ENABLED=True)
    def test_untimed_native_sheet_training_reference_does_not_create_calendar_session(self):
        item = WorkItem.objects.create(
            creator=self.executor,
            executor=self.executor,
            title="Dự kiến nhân sự và chương trình tập huấn STEM AI",
            work_date="2026-09-08",
            label="Tập huấn",
            source_sheet_row=5002,
            source_record_id="REC-SHEET-001",
            time_prefix_in_title=False,
        )

        from .training_sync import sync_training_from_work_item
        self.assertIsNone(sync_training_from_work_item(item))
        item.refresh_from_db()
        self.assertIsNone(item.training_session_id)

        item.title = "Tập huấn STEM AI"
        item.start_time = time(8, 30)
        item.time_prefix_in_title = True
        item.save()
        self.assertIsNotNone(sync_training_from_work_item(item))

    def test_training_work_item_is_only_a_suggestion_while_projection_is_paused(self):
        from .training_sync import sync_training_from_work_item

        item = WorkItem.objects.create(
            creator=self.executor,
            executor=self.executor,
            title="Tập huấn B3 TH Kim Đồng",
            work_date="2026-09-12",
            start_time=time(8, 30),
            label="Tập huấn",
            time_prefix_in_title=True,
        )

        self.assertIsNone(sync_training_from_work_item(item))
        item.refresh_from_db()
        self.assertIsNone(item.training_session_id)

    def test_internal_training_session_is_never_deleted_by_sheet_projection(self):
        from digital_training.models import TrainingSession
        from .training_sync import sync_training_from_work_item

        session = TrainingSession.objects.create(
            title="Buổi 7 · Khách hàng nội bộ",
            session_date="2026-09-08",
            start_time=time(17, 30),
            end_time=time(20, 30),
            source=TrainingSession.SOURCE_INTERNAL,
        )
        item = WorkItem.objects.create(
            creator=self.executor,
            executor=self.executor,
            title=session.title,
            work_date=session.session_date,
            training_session=session,
            source_sheet_row=5003,
            source_record_id="REC-SHEET-OLD",
            time_prefix_in_title=False,
        )

        self.assertEqual(sync_training_from_work_item(item), session)
        self.assertTrue(TrainingSession.objects.filter(pk=session.pk).exists())
        item.refresh_from_db()
        self.assertEqual(item.training_session_id, session.pk)

    def test_organisational_manager_views_report_only_in_team_schedule(self):
        self.executor.manager = self.manager
        self.executor.save(update_fields=["manager"])
        response = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Việc của nhân viên", "date": "2026-09-17",
            "executorEmail": self.executor.email, "supporterEmails": [], "managerEmails": [],
        })
        self.assertEqual(response.status_code, 201, response.data)
        manager_rows = self.request(self.manager_token, "get", "/api/work-schedule/items").json()["items"]
        self.assertNotIn(response.json()["item"]["id"], [row["id"] for row in manager_rows])
        team_rows = self.request(self.manager_token, "get", "/api/work-schedule/team").json()["items"]
        row = next(item for item in team_rows if item["id"] == response.json()["item"]["id"])
        self.assertEqual(row["viewerRelation"], "team_viewer")
        self.assertEqual(row["displayTitle"], "Việc của nhân viên")
        self.assertFalse(row["canDelete"])
        self.assertFalse(row["canReview"])

    def test_team_endpoint_lists_only_direct_reports_for_manager(self):
        self.executor.manager = self.manager
        self.executor.employee_code = "FT-09"
        self.executor.save(update_fields=["manager", "employee_code"])
        response = self.request(self.manager_token, "get", "/api/work-schedule/team")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([member["email"] for member in response.json()["members"]], [self.executor.email])
        self.assertEqual(response.json()["members"][0]["employeeCode"], "FT-09")

    def test_admin_can_manage_every_employee_without_adding_manager_title(self):
        admin, admin_token = self.profile("admin@example.com", "ADMIN")
        item = self.request(self.executor_token, "post", "/api/work-schedule/items", {
            "title": "Lịch riêng của nhân viên", "date": "2026-09-18",
            "executorEmail": self.executor.email, "supporterEmails": [], "managerEmails": [],
        }).json()["item"]
        admin_items = self.request(admin_token, "get", "/api/work-schedule/items").json()["items"]
        self.assertNotIn(item["id"], [row["id"] for row in admin_items])
        team = self.request(admin_token, "get", "/api/work-schedule/team").json()
        self.assertIn(self.executor.email, [member["email"] for member in team["members"]])
        admin_row = next(row for row in team["items"] if row["id"] == item["id"])
        self.assertEqual(admin_row["displayTitle"], "Lịch riêng của nhân viên")
        self.assertTrue(admin_row["canEdit"])
        self.assertTrue(admin_row["canDelete"])
        self.assertTrue(admin_row["canManagePeople"])
        self.assertEqual(self.request(admin_token, "get", f"/api/work-schedule/items/{item['id']}").status_code, 200)

        updated = self.request(admin_token, "patch", f"/api/work-schedule/items/{item['id']}", {
            "title": item["title"], "date": "2026-09-19", "executorEmail": self.executor.email,
            "supporterEmails": [], "managerEmails": [], "status": "completed",
        })
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.json()["item"]["date"], "2026-09-19")
        self.assertTrue(updated.json()["item"]["canReview"])
        reviewed = self.request(admin_token, "post", f"/api/work-schedule/items/{item['id']}/review", {
            "action": "confirm", "reviewPercent": 100,
        })
        self.assertEqual(reviewed.status_code, 200, reviewed.data)
        self.assertEqual(reviewed.json()["item"]["status"], "reviewed")

        created = self.request(admin_token, "post", "/api/work-schedule/items", {
            "title": "Admin giao việc không chỉ định quản lý", "date": "2026-09-20",
            "executorEmail": self.executor.email, "supporterEmails": [], "managerEmails": [],
        })
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.json()["item"]["displayTitle"], "Admin giao việc không chỉ định quản lý")

    def test_executor_never_sees_manager_review_controls_or_details(self):
        item = self.create_item()
        WorkItem.objects.filter(pk=item["id"]).update(
            status="completed", review_percent=85, review_note="Cần rà soát"
        )
        executor_row = self.request(
            self.executor_token, "get", f"/api/work-schedule/items/{item['id']}"
        ).json()
        self.assertFalse(executor_row["canReview"])
        self.assertIsNone(executor_row["reviewPercent"])
        self.assertEqual(executor_row["reviewNote"], "")

        manager_row = self.request(
            self.manager_token, "get", f"/api/work-schedule/items/{item['id']}"
        ).json()
        self.assertTrue(manager_row["canReview"])
        self.assertEqual(manager_row["reviewPercent"], 85)


class WorkScheduleSheetLeaseTests(TestCase):
    def test_lease_is_released_when_sync_raises(self):
        with self.assertRaises(RuntimeError):
            with sync_lease(seconds=60) as acquired:
                self.assertTrue(acquired)
                raise RuntimeError("sync failed")

        lease = WorkScheduleSheetSyncLease.objects.get(key="ft-work-schedule")
        self.assertIsNone(lease.locked_until)

    def test_active_lease_rejects_a_second_sync(self):
        with sync_lease(seconds=60) as first_acquired:
            self.assertTrue(first_acquired)
            with sync_lease(seconds=60) as second_acquired:
                self.assertFalse(second_acquired)

    def test_stale_lease_can_be_reacquired(self):
        WorkScheduleSheetSyncLease.objects.create(
            key="ft-work-schedule",
            locked_until=timezone.now() - timedelta(seconds=1),
        )
        with sync_lease(seconds=60) as acquired:
            self.assertTrue(acquired)

    def test_expired_owner_cannot_release_a_newer_lease(self):
        replacement_expiry = timezone.now() + timedelta(minutes=10)
        with sync_lease(seconds=60) as acquired:
            self.assertTrue(acquired)
            WorkScheduleSheetSyncLease.objects.filter(key="ft-work-schedule").update(
                locked_until=replacement_expiry
            )

        lease = WorkScheduleSheetSyncLease.objects.get(key="ft-work-schedule")
        self.assertEqual(lease.locked_until, replacement_expiry)


class WorkScheduleSheetCapacityTests(TestCase):
    def test_formula_content_rows_are_excluded_from_rich_text_formatting(self):
        service = mock.Mock()
        service.spreadsheets.return_value.get.return_value.execute.return_value = {
            "sheets": [{"data": [{
                "startRow": 1,
                "rowData": [
                    {"values": [{"userEnteredValue": {"stringValue": "Văn bản"}}]},
                    {"values": [{"userEnteredValue": {"formulaValue": "=QUERY(A:K)"}}]},
                    {},
                ],
            }]}]
        }

        self.assertEqual(_formula_content_rows(service), {3})

    def test_sheet_is_extended_before_writing_beyond_grid(self):
        service = mock.Mock()
        service.spreadsheets.return_value.get.return_value.execute.return_value = {
            "sheets": [{"properties": {"sheetId": 1443841670, "gridProperties": {"rowCount": 6109}}}]
        }

        resulting_rows = ensure_sheet_row_capacity(service, 6110)

        self.assertEqual(resulting_rows, 6609)
        body = service.spreadsheets.return_value.batchUpdate.call_args.kwargs["body"]
        self.assertEqual(body["requests"][0]["appendDimension"]["length"], 500)

    def test_sheet_is_not_extended_when_target_row_already_fits(self):
        service = mock.Mock()
        service.spreadsheets.return_value.get.return_value.execute.return_value = {
            "sheets": [{"properties": {"sheetId": 1443841670, "gridProperties": {"rowCount": 7000}}}]
        }

        resulting_rows = ensure_sheet_row_capacity(service, 6110)

        self.assertEqual(resulting_rows, 7000)
        service.spreadsheets.return_value.batchUpdate.assert_not_called()


@mock.patch.dict(os.environ, {"SHEET_WEBHOOK_SECRET": "test-webhook-secret"})
class WorkScheduleSheetWebhookTests(TestCase):
    """NOTE: migrations 0004/0006/0009/0010 seed real historical WorkItem/WorkScheduleSheetChange
    rows (incl. for sondc@fermat.edu.vn) into every fresh test DB, so assertions here always
    scope by `source_sheet_row=ROW_NUMBER` / count deltas instead of bare exists()/get()."""

    WEBHOOK_PATH = "/api/work-schedule/sheet-webhook"
    EMPLOYEE_EMAIL = "sondc@fermat.edu.vn"
    EMPLOYEE_ID = "EMP-ABD98A8B"
    ROW_NUMBER = 5001

    def setUp(self):
        self.assertEqual(EMPLOYEE_EMAILS[self.EMPLOYEE_ID], self.EMPLOYEE_EMAIL)
        UserProfile.objects.filter(email=self.EMPLOYEE_EMAIL).delete()
        UserProfile.objects.create(email=self.EMPLOYEE_EMAIL, name="Đặng Chí Sơn", role="EMPLOYEE", access_modules=[])
        WorkItem.objects.filter(source_sheet_row=self.ROW_NUMBER).delete()

    def post(self, payload, secret="test-webhook-secret"):
        headers = {"HTTP_X_SHEET_WEBHOOK_SECRET": secret} if secret is not None else {}
        return self.client.post(self.WEBHOOK_PATH, payload, content_type="application/json", **headers)

    def row_values(self, event_marker="Việc test webhook"):
        return ["Ba", "08/09/2026", "37", "Đặng Chí Sơn", f"1. {event_marker}", "", "", self.EMPLOYEE_ID, "REC-TEST-001", "", ""]

    def test_iso_date_from_legacy_get_values_is_ingested_in_local_timezone(self):
        values = self.row_values("Việc từ ngày ISO")
        values[1] = "2026-09-07T17:00:00.000Z"
        with mock.patch("work_schedule.sheet_sync._service"), \
             mock.patch("work_schedule.sheet_sync.ensure_sync_columns"), \
             mock.patch("work_schedule.sheet_sync.push_groups_to_sheet"):
            response = self.post({"event_id": "evt-iso-date", "row": self.ROW_NUMBER, "values": values})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["createdCount"], 1)
        item = WorkItem.objects.get(source_sheet_row=self.ROW_NUMBER, source_task_index=1)
        self.assertEqual(item.work_date.isoformat(), "2026-09-08")

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_repeated_task_lines_in_one_row_create_only_one_item(self, mock_service, mock_ensure, mock_push):
        values = self.row_values()
        values[4] = "1. Nhiệm vụ bị lặp\n2. Nhiệm vụ bị lặp"

        response = self.post({"event_id": "evt-duplicate-lines", "row": self.ROW_NUMBER, "values": values})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["createdCount"], 1)
        self.assertEqual(WorkItem.objects.filter(source_sheet_row=self.ROW_NUMBER).count(), 1)

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_clearing_row_content_deletes_tasks_previously_sourced_from_that_row(self, mock_service, mock_ensure, mock_push):
        first = self.post({"event_id": "evt-row-create", "row": self.ROW_NUMBER, "values": self.row_values("Việc sẽ xóa")})
        self.assertEqual(first.status_code, 200, first.content)
        self.assertTrue(WorkItem.objects.filter(source_sheet_row=self.ROW_NUMBER).exists())
        cleared_values = self.row_values("")
        cleared_values[4] = ""

        cleared = self.post({"event_id": "evt-row-clear", "row": self.ROW_NUMBER, "values": cleared_values})

        self.assertEqual(cleared.status_code, 200, cleared.content)
        self.assertEqual(cleared.json()["deletedCount"], 1)
        self.assertFalse(WorkItem.objects.filter(source_sheet_row=self.ROW_NUMBER).exists())
        self.assertEqual(cleared.json()["groups"], [[self.EMPLOYEE_EMAIL, "2026-09-08"]])

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_rejects_request_without_correct_secret(self, mock_service, mock_ensure, mock_push):
        response = self.post({"event_id": "evt-1", "row": self.ROW_NUMBER, "values": self.row_values()}, secret="wrong-secret")
        self.assertEqual(response.status_code, 401, response.content)
        response = self.post({"event_id": "evt-1", "row": self.ROW_NUMBER, "values": self.row_values()}, secret=None)
        self.assertEqual(response.status_code, 401, response.content)
        self.assertFalse(WorkItem.objects.filter(source_sheet_row=self.ROW_NUMBER).exists())
        mock_service.assert_not_called()

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_valid_edit_creates_work_item_and_writes_task_id_back_to_sheet(self, mock_service, mock_ensure, mock_push):
        response = self.post({"event_id": "evt-2", "row": self.ROW_NUMBER, "values": self.row_values()})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["createdCount"], 1)
        self.assertEqual(body["updatedCount"], 0)
        item = WorkItem.objects.get(source_sheet_row=self.ROW_NUMBER, source_task_index=1)
        self.assertEqual(item.executor_id, self.EMPLOYEE_EMAIL)
        self.assertEqual(item.title, "Việc test webhook")
        self.assertEqual(item.work_date.isoformat(), "2026-09-08")
        mock_push.assert_called_once()
        touched_groups = mock_push.call_args.args[1]
        self.assertEqual(touched_groups, {(self.EMPLOYEE_EMAIL, item.work_date)})

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_row_move_without_task_id_keeps_the_same_work_item(self, mock_service, mock_ensure, mock_push):
        values = self.row_values("Việc được di chuyển")
        values[7] = ""  # EmployeeID is optional; staff name + date identify the row.
        first = self.post({"event_id": "evt-move-create", "row": self.ROW_NUMBER, "values": values})
        self.assertEqual(first.status_code, 200, first.content)
        item = WorkItem.objects.get(source_sheet_row=self.ROW_NUMBER)
        original_pk = item.pk
        original_uid = item.sync_uid

        moved = self.post({"event_id": "evt-move-destination", "row": self.ROW_NUMBER + 25, "values": values})

        self.assertEqual(moved.status_code, 200, moved.content)
        item.refresh_from_db()
        self.assertEqual(item.pk, original_pk)
        self.assertEqual(item.sync_uid, original_uid)
        self.assertEqual(item.source_sheet_row, self.ROW_NUMBER + 25)
        self.assertEqual(WorkItem.objects.filter(executor_id=self.EMPLOYEE_EMAIL, work_date="2026-09-08").count(), 1)

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_copied_task_id_cannot_move_work_to_another_person(self, mock_service, mock_ensure, mock_push):
        original = WorkItem.objects.create(
            creator_id=self.EMPLOYEE_EMAIL, executor_id=self.EMPLOYEE_EMAIL,
            title="Việc của Sơn", work_date="2026-09-08", source_sheet_row=self.ROW_NUMBER,
            source_task_index=1,
        )
        other = UserProfile.objects.create(
            email="other-sheet-user@example.com", name="Nguyễn Văn Khác",
            role="EMPLOYEE", access_modules=[],
        )
        values = [
            "Ba", "08/09/2026", "37", other.name, "1. Việc được sao chép", "", "",
            "", "", f"1. {original.sync_uid}", "",
        ]

        response = self.post({"event_id": "evt-cross-person-copy", "row": self.ROW_NUMBER + 40, "values": values})

        self.assertEqual(response.status_code, 200, response.content)
        original.refresh_from_db()
        self.assertEqual(original.executor_id, self.EMPLOYEE_EMAIL)
        copied = WorkItem.objects.get(executor=other, work_date="2026-09-08")
        self.assertNotEqual(copied.sync_uid, original.sync_uid)

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_competing_duplicate_row_without_group_ids_cannot_overwrite_canonical_tasks(
        self, mock_service, mock_ensure, mock_push
    ):
        original = WorkItem.objects.create(
            creator_id=self.EMPLOYEE_EMAIL, executor_id=self.EMPLOYEE_EMAIL,
            title="Nhiệm vụ đầy đủ", work_date="2026-09-08",
            source_sheet_row=self.ROW_NUMBER, source_task_index=1,
        )
        duplicate_values = self.row_values("Bản cũ bị thiếu")
        duplicate_values[9] = ""

        response = self.post({
            "event_id": "evt-competing-duplicate",
            "row": self.ROW_NUMBER + 1,
            "values": duplicate_values,
        })

        self.assertEqual(response.status_code, 200, response.content)
        original.refresh_from_db()
        self.assertEqual(original.title, "Nhiệm vụ đầy đủ")
        self.assertEqual(original.source_sheet_row, self.ROW_NUMBER)
        self.assertEqual(
            WorkItem.objects.filter(executor_id=self.EMPLOYEE_EMAIL, work_date="2026-09-08").count(),
            1,
        )

    def test_two_phase_pull_preserves_task_identity_when_rows_change_dates(self):
        first = WorkItem.objects.create(
            creator_id=self.EMPLOYEE_EMAIL, executor_id=self.EMPLOYEE_EMAIL,
            title="Việc ngày 08", work_date="2026-09-08", source_sheet_row=self.ROW_NUMBER,
            source_task_index=1,
        )
        second = WorkItem.objects.create(
            creator_id=self.EMPLOYEE_EMAIL, executor_id=self.EMPLOYEE_EMAIL,
            title="Việc ngày 09", work_date="2026-09-09", source_sheet_row=self.ROW_NUMBER + 1,
            source_task_index=1,
        )
        rows = [
            ["Ba", "08/09/2026", "37", "Sơn", "1. Việc ngày 09", "", "", "", "", f"1. {second.sync_uid}", ""],
            ["Tư", "09/09/2026", "37", "Sơn", "1. Việc ngày 08", "", "", "", "", f"1. {first.sync_uid}", ""],
        ]
        with mock.patch("work_schedule.sheet_sync._retained_sheet_start_row", return_value=self.ROW_NUMBER), \
             mock.patch("work_schedule.sheet_sync._rows", return_value=rows):
            result = pull_from_sheet(mock.MagicMock(), date(2026, 9, 1), date(2026, 9, 30))

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.work_date.isoformat(), "2026-09-09")
        self.assertEqual(second.work_date.isoformat(), "2026-09-08")
        self.assertEqual(first.source_sheet_row, self.ROW_NUMBER + 1)
        self.assertEqual(second.source_sheet_row, self.ROW_NUMBER)
        self.assertEqual(WorkItem.objects.filter(pk__in=[first.pk, second.pk]).count(), 2)
        self.assertEqual(result["deleted"], 0)

    def test_full_pull_prefers_duplicate_name_date_row_with_valid_task_ids(self):
        item = WorkItem.objects.create(
            creator_id=self.EMPLOYEE_EMAIL, executor_id=self.EMPLOYEE_EMAIL,
            title="Việc đầy đủ", work_date="2026-09-08", source_sheet_row=self.ROW_NUMBER,
            source_task_index=1,
        )
        rows = [
            ["Ba", "08/09/2026", "37", "Sơn", "1. Việc đầy đủ", "", "", "", "", f"1. {item.sync_uid}", ""],
            ["Ba", "08/09/2026", "37", "Sơn", "1. Bản cũ thiếu ID", "", "", "", "", "REC-LEGACY", ""],
        ]
        with mock.patch("work_schedule.sheet_sync._retained_sheet_start_row", return_value=self.ROW_NUMBER), \
             mock.patch("work_schedule.sheet_sync._rows", return_value=rows):
            result = pull_from_sheet(mock.MagicMock(), date(2026, 9, 1), date(2026, 9, 30))

        item.refresh_from_db()
        self.assertEqual(item.title, "Việc đầy đủ")
        self.assertEqual(item.source_sheet_row, self.ROW_NUMBER)
        self.assertEqual(result["duplicateGroups"][0]["selectedRow"], self.ROW_NUMBER)
        self.assertEqual(result["duplicateGroups"][0]["rows"], [self.ROW_NUMBER, self.ROW_NUMBER + 1])

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_time_prefixed_sheet_row_is_high_priority(self, mock_service, mock_ensure, mock_push):
        values = self.row_values("8h: Gửi báo cáo")
        response = self.post({"event_id": "evt-time-priority", "row": self.ROW_NUMBER, "values": values})
        self.assertEqual(response.status_code, 200, response.content)
        item = WorkItem.objects.get(source_sheet_row=self.ROW_NUMBER)
        self.assertEqual(item.title, "8h: Gửi báo cáo")
        self.assertEqual(item.start_time.isoformat(timespec="minutes"), "08:00")
        self.assertEqual(item.priority, "high")
        self.assertTrue(item.time_prefix_in_title)

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_ingesting_from_sheet_does_not_queue_a_web_to_sheet_push_back(self, mock_service, mock_ensure, mock_push):
        before = WorkScheduleSheetChange.objects.count()
        self.post({"event_id": "evt-3", "row": self.ROW_NUMBER, "values": self.row_values()})
        self.assertEqual(WorkScheduleSheetChange.objects.count(), before)

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_duplicate_event_id_is_not_reprocessed(self, mock_service, mock_ensure, mock_push):
        first = self.post({"event_id": "evt-4", "row": self.ROW_NUMBER, "values": self.row_values("Việc gốc")})
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(mock_push.call_count, 1)

        retry = self.post({"event_id": "evt-4", "row": self.ROW_NUMBER, "values": self.row_values("Việc đã đổi khác (không nên áp dụng)")})
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(retry.json()["message"], "Sự kiện đã được xử lý trước đó (bỏ qua để tránh trùng lặp).")
        self.assertEqual(mock_push.call_count, 1)
        self.assertEqual(WorkItem.objects.get(source_sheet_row=self.ROW_NUMBER, source_task_index=1).title, "Việc gốc")
        self.assertEqual(WorkScheduleSheetInboundEvent.objects.filter(event_id="evt-4").count(), 1)

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_rejects_payload_missing_required_fields(self, mock_service, mock_ensure, mock_push):
        response = self.post({"event_id": "evt-5", "values": self.row_values()})
        self.assertEqual(response.status_code, 400, response.content)
        mock_service.assert_not_called()

    @mock.patch("work_schedule.sheet_sync.full_two_way_sync")
    def test_full_sync_does_not_require_row_values_and_is_deduplicated(self, mock_full_sync):
        mock_full_sync.return_value = {
            "start": "1900-01-01",
            "end": "9999-12-31",
            "pulled": {"created": 2, "updated": 5, "groups": 3},
            "pushed": {"groups": 3, "tasks": 7, "conflicts": []},
        }
        payload = {
            "event_id": "evt-full-1",
            "event_type": "full_sync",
            "sheet_name": "Lịch công tác",
            "reason": "manual_test",
        }

        response = self.post(payload)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["eventType"], "full_sync")
        self.assertEqual(response.json()["createdCount"], 2)
        self.assertEqual(response.json()["updatedCount"], 5)
        mock_full_sync.assert_called_once_with(None)

        duplicate = self.post(payload)
        self.assertEqual(duplicate.status_code, 200, duplicate.content)
        self.assertIn("đã được xử lý trước đó", duplicate.json()["message"])
        mock_full_sync.assert_called_once_with(None)

    @mock.patch("work_schedule.sheet_sync.full_two_way_sync")
    def test_full_sync_rejects_an_unexpected_sheet_name(self, mock_full_sync):
        response = self.post({
            "event_id": "evt-full-wrong-sheet",
            "event_type": "full_sync",
            "sheet_name": "Tab khác",
        })
        self.assertEqual(response.status_code, 400, response.content)
        mock_full_sync.assert_not_called()

    @mock.patch("work_schedule.sheet_sync.full_two_way_sync")
    def test_full_sync_busy_is_acknowledged_without_a_gateway_error(self, mock_full_sync):
        mock_full_sync.return_value = {"busy": True, "message": "Một lượt đồng bộ khác đang chạy."}
        response = self.post({
            "event_id": "evt-full-busy",
            "event_type": "full_sync",
            "sheet_name": "Lịch công tác",
            "reason": "watchdog",
        })

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "skipped_busy")
        event = WorkScheduleSheetInboundEvent.objects.get(event_id="evt-full-busy")
        self.assertEqual(event.status, WorkScheduleSheetInboundEvent.STATUS_SKIPPED)

    @mock.patch("work_schedule.sheet_sync.full_two_way_sync")
    def test_duplicate_in_flight_full_sync_returns_accepted(self, mock_full_sync):
        payload = {
            "event_type": "full_sync",
            "sheet_name": "Lịch công tác",
            "reason": "watchdog",
        }
        WorkScheduleSheetInboundEvent.objects.create(
            event_id="evt-full-in-flight",
            row_number=1,
            payload=payload,
            status=WorkScheduleSheetInboundEvent.STATUS_PROCESSING,
        )

        response = self.post({"event_id": "evt-full-in-flight", **payload})

        self.assertEqual(response.status_code, 202, response.content)
        self.assertEqual(response.json()["status"], WorkScheduleSheetInboundEvent.STATUS_PROCESSING)
        mock_full_sync.assert_not_called()

    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_push_back_failure_does_not_fail_the_webhook_or_lose_the_ingested_item(self, mock_service, mock_ensure):
        with mock.patch("work_schedule.sheet_sync.push_groups_to_sheet", side_effect=RuntimeError("Sheets API quota")):
            response = self.post({"event_id": "evt-6", "row": self.ROW_NUMBER, "values": self.row_values()})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["pushBackError"], "Sheets API quota")
        self.assertTrue(WorkItem.objects.filter(source_sheet_row=self.ROW_NUMBER).exists())
        event = WorkScheduleSheetInboundEvent.objects.get(event_id="evt-6")
        self.assertEqual(event.status, WorkScheduleSheetInboundEvent.STATUS_PROCESSED)
        self.assertIn("Sheets API quota", event.error)

    @mock.patch("work_schedule.sheet_sync.push_groups_to_sheet")
    @mock.patch("work_schedule.sheet_sync.ensure_sync_columns")
    @mock.patch("work_schedule.sheet_sync._service")
    def test_retrying_a_failed_event_id_actually_reprocesses_instead_of_no_opping(self, mock_service, mock_ensure, mock_push):
        from .sheet_sync import _ingest_row as real_ingest_row

        call_count = {"n": 0}

        def flaky_ingest_row(*args, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise RuntimeError("Sheets API tạm lỗi")
            return real_ingest_row(*args, **kwargs)

        with mock.patch("work_schedule.sheet_sync._ingest_row", side_effect=flaky_ingest_row):
            first = self.post({"event_id": "evt-7", "row": self.ROW_NUMBER, "values": self.row_values()})
            self.assertEqual(first.status_code, 502, first.content)
            event = WorkScheduleSheetInboundEvent.objects.get(event_id="evt-7")
            self.assertEqual(event.status, WorkScheduleSheetInboundEvent.STATUS_FAILED)
            self.assertFalse(WorkItem.objects.filter(source_sheet_row=self.ROW_NUMBER).exists())

            retry = self.post({"event_id": "evt-7", "row": self.ROW_NUMBER, "values": self.row_values()})
            self.assertEqual(retry.status_code, 200, retry.content)

        self.assertEqual(call_count["n"], 2)
        event.refresh_from_db()
        self.assertEqual(event.status, WorkScheduleSheetInboundEvent.STATUS_PROCESSED)
        self.assertTrue(WorkItem.objects.filter(source_sheet_row=self.ROW_NUMBER).exists())
        self.assertEqual(WorkScheduleSheetInboundEvent.objects.filter(event_id="evt-7").count(), 1)
