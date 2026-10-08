from datetime import date, time
from unittest import mock

from django.test import TestCase

from authentication.models import SystemConfig, UserProfile
from digital_training.models import TrainingSession

from .models import TimesheetEntry
from .sheet_sync import _date_rows, push_groups_to_attendance_sheet


SPREADSHEET_ID = "1OvmMuvQuquVyTyjZVm8yDGryWz6Lp5vIny3Ttei7SH8"


class AttendanceSheetSyncTests(TestCase):
    def setUp(self):
        self.profile = UserProfile.objects.create(
            email="phong@example.com",
            name="Nguyễn Thanh Phong",
            role="EMPLOYEE",
        )
        SystemConfig.objects.update_or_create(
            key="monthly_sheet_links",
            defaults={
                "data": {
                    "links": {
                        "attendance": {
                            "2026-09": f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit"
                        }
                    }
                }
            },
        )

    def service(self, month="9"):
        service = mock.Mock()
        sheets = service.spreadsheets.return_value
        values = sheets.values.return_value
        sheets.get.return_value.execute.return_value = {
            "sheets": [{
                "properties": {
                    "sheetId": 1088395873,
                    "title": self.profile.name,
                    "gridProperties": {"rowCount": 1000, "columnCount": 32},
                }
            }]
        }
        values.batchGet.return_value.execute.return_value = {
            "valueRanges": [
                {"values": [[month, "2026"]]},
                {"values": [["Ba", "1"], ["Tư", "2"], ["Năm", "3"], ["Sáu", "4"]]},
            ]
        }
        values.batchUpdate.return_value.execute.return_value = {}
        sheets.batchUpdate.return_value.execute.return_value = {}
        return service

    def create_shift(self, number, start_hour=8, mode="direct"):
        return TimesheetEntry.objects.create(
            employee=self.profile,
            work_date=date(2026, 9, 3),
            shift_number=number,
            shift_start=time(start_hour, 0),
            shift_end=time(start_hour + 1, 0),
            work_mode=mode,
        )

    def test_tab_copied_from_a_30_day_month_gets_the_31st_inside_the_totals(self):
        SystemConfig.objects.filter(key="monthly_sheet_links").update(data={"links": {"attendance": {
            "2026-10": f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit"}}})
        TimesheetEntry.objects.create(employee=self.profile, work_date=date(2026, 10, 31), shift_number=1,
            shift_start=time(8, 0), shift_end=time(9, 0), work_mode="direct")
        service = self.service(month="10")
        labels = ["Năm", "Sáu", "Bảy", "CN", "Hai", "Ba", "Tư"]
        service.spreadsheets.return_value.values.return_value.batchGet.return_value.execute.return_value = {
            "valueRanges": [{"values": [["10", "2026"]]},
                            {"values": [[labels[(day - 1) % 7], str(day)] for day in range(1, 31)] + [["Tổng"]]}]}

        result = push_groups_to_attendance_sheet(service, {(self.profile.email, date(2026, 10, 31))})

        self.assertEqual(result["skipped"], [])
        self.assertEqual(result["insertedRows"], 1)
        insert = service.spreadsheets.return_value.batchUpdate.call_args_list[0].kwargs["body"]["requests"][0]["insertDimension"]
        # Day 30 sits on row 38; the new row is inserted above it (index 37) so
        # SUM(…9:…38) grows, then the freed row 39 becomes the 31st.
        self.assertEqual((insert["range"]["startIndex"], insert["range"]["endIndex"]), (37, 38))
        writes = [call.kwargs["body"]["data"] for call in service.spreadsheets.return_value.values.return_value.batchUpdate.call_args_list]
        self.assertIn({"range": "'Nguyễn Thanh Phong'!A39:B39", "values": [["Bảy", 31]]}, writes[0])
        self.assertTrue(any(item["range"] == "'Nguyễn Thanh Phong'!C39:K39" and item["values"][0][:2] == ["08:00", "09:00"] for item in writes[-1]))

    def test_date_lookup_requires_weekday_and_uses_column_b(self):
        rows = [["Ba", "1"], ["", "2"], ["Tổng", "3"], ["Năm", "3"]]
        self.assertEqual(dict(_date_rows(rows)), {1: [9], 3: [12]})

    def test_writes_only_shift_columns_and_training_note_column(self):
        self.create_shift(1, 8)
        self.create_shift(2, 13, "online")
        TrainingSession.objects.create(
            title="B1 GCE THCS Nguyễn Du",
            session_date=date(2026, 9, 3),
            instructor_name=self.profile.name,
            status="planned",
        )
        service = self.service()

        result = push_groups_to_attendance_sheet(
            service, {(self.profile.email, date(2026, 9, 3))}
        )

        self.assertEqual(result["groups"], 1)
        data = service.spreadsheets.return_value.values.return_value.batchUpdate.call_args.kwargs["body"]["data"]
        self.assertEqual([item["range"] for item in data], [
            "'Nguyễn Thanh Phong'!C11:K11",
            "'Nguyễn Thanh Phong'!R11",
        ])
        self.assertEqual(data[0]["values"][0][:6], ["08:00", "09:00", False, "13:00", "14:00", True])
        self.assertEqual(data[1]["values"], [["Tập huấn B1 GCE THCS Nguyễn Du"]])
        format_body = service.spreadsheets.return_value.batchUpdate.call_args.kwargs["body"]
        self.assertEqual(format_body["requests"][0]["repeatCell"]["range"]["startColumnIndex"], 17)

    @mock.patch("attendance.sheet_sync.timezone.localdate", return_value=date(2026, 9, 2))
    def test_future_training_session_is_not_written_to_note_column(self, _localdate):
        self.create_shift(1, 8)
        TrainingSession.objects.create(
            title="Lịch tập huấn tương lai",
            session_date=date(2026, 9, 3),
            instructor_name=self.profile.name,
            status="planned",
        )
        service = self.service()

        push_groups_to_attendance_sheet(
            service, {(self.profile.email, date(2026, 9, 3))}
        )

        data = service.spreadsheets.return_value.values.return_value.batchUpdate.call_args.kwargs["body"]["data"]
        self.assertEqual(data[1], {
            "range": "'Nguyễn Thanh Phong'!R11",
            "values": [[""]],
        })
        format_body = service.spreadsheets.return_value.batchUpdate.call_args.kwargs["body"]
        self.assertEqual(
            format_body["requests"][0]["repeatCell"]["cell"],
            {"userEnteredFormat": {}},
        )

    def test_more_than_three_shifts_inserts_inherited_row_and_continues(self):
        for number, hour in enumerate((8, 10, 13, 16), start=1):
            self.create_shift(number, hour)
        service = self.service()

        result = push_groups_to_attendance_sheet(
            service, {(self.profile.email, date(2026, 9, 3))}
        )

        self.assertEqual(result["insertedRows"], 1)
        structural = service.spreadsheets.return_value.batchUpdate.call_args_list[0].kwargs["body"]["requests"]
        self.assertIn("insertDimension", structural[0])
        self.assertIn("copyPaste", structural[1])
        data = service.spreadsheets.return_value.values.return_value.batchUpdate.call_args.kwargs["body"]["data"]
        self.assertEqual([item["range"] for item in data], [
            "'Nguyễn Thanh Phong'!C11:K11",
            "'Nguyễn Thanh Phong'!R11",
            "'Nguyễn Thanh Phong'!C12:K12",
            "'Nguyễn Thanh Phong'!R12",
        ])
        self.assertEqual(data[2]["values"][0][:3], ["16:00", "17:00", False])

    def test_wrong_m4_skips_the_group_without_any_value_write(self):
        self.create_shift(1)
        service = self.service(month="8")

        result = push_groups_to_attendance_sheet(
            service, {(self.profile.email, date(2026, 9, 3))}
        )

        self.assertIn("M4 đang là tháng 8", result["skipped"][0]["reason"])
        service.spreadsheets.return_value.values.return_value.batchUpdate.assert_not_called()

    def test_missing_date_row_skips_only_that_day(self):
        self.create_shift(1)
        service = self.service()

        result = push_groups_to_attendance_sheet(
            service, {(self.profile.email, date(2026, 9, 3)), (self.profile.email, date(2026, 9, 30))}
        )

        self.assertEqual([item["date"] for item in result["skipped"]], ["2026-09-30"])
        self.assertEqual(result["groups"], 1)
        service.spreadsheets.return_value.values.return_value.batchUpdate.assert_called_once()
