import datetime
from unittest.mock import MagicMock, patch

from django.test import TestCase

from authentication.models import SystemConfig
from digital_training.models import TrainingClass, TrainingPartner, TrainingSession
from digital_training.training_sheet_sync import (
    HEADERS,
    export_training_sessions_to_sheet,
    import_training_sessions_from_sheet,
)


class TrainingSheetSyncTests(TestCase):
    def setUp(self):
        self.partner = TrainingPartner.objects.create(name="THCS Nguyễn Du", province="Hà Nội")
        self.t_class = TrainingClass.objects.create(
            partner=self.partner,
            name="Khối 6-7",
            planned_sessions=5,
        )
        self.session = TrainingSession.objects.create(
            partner_ref=self.partner,
            partner=self.partner.name,
            training_class=self.t_class,
            title="Tập huấn GCE1 THCS Nguyễn Du",
            session_date=datetime.date(2026, 10, 28),
            start_time=datetime.time(14, 0),
            end_time=datetime.time(16, 30),
            session_number=2,
            instructor_name="Thầy Nguyễn Văn A",
            support_staff_name="Cô Trần B",
            location="Phòng Hội đồng",
            attendees=45,
            status="completed",
            notes="Lớp tiếp thu tốt",
        )

    @patch("digital_training.training_sheet_sync.build_sheets_service")
    def test_export_generates_correct_columns_and_data(self, mock_build):
        mock_service = MagicMock()
        mock_build.return_value = mock_service

        # Mock metadata
        mock_service.spreadsheets().get().execute.return_value = {
            "sheets": [{"properties": {"sheetId": 123, "title": "Nhật ký tập huấn"}}]
        }
        # Mock reading existing rows
        mock_service.spreadsheets().values().get().execute.return_value = {"values": []}

        result = export_training_sessions_to_sheet(force=True)
        self.assertEqual(result["status"], "synced")
        self.assertEqual(result["count"], 1)

        # Check values update call
        update_call = mock_service.spreadsheets().values().update.call_args
        self.assertIsNotNone(update_call)
        body = update_call[1]["body"]["values"]

        # Hàng 1: Banner
        self.assertIn("FT. NHẬT KÝ & TIẾN ĐỘ TẬP HUẤN ĐÀO TẠO SỐ", body[0][0])
        # Hàng 2: Header (16 cột)
        self.assertEqual(body[1], HEADERS)
        self.assertEqual(len(body[1]), 16)

        # Hàng 3: Dòng dữ liệu
        row = body[2]
        self.assertEqual(row[0], 1)                           # STT
        self.assertEqual(row[1], self.session.id)             # Mã Buổi
        self.assertEqual(row[2], "28/10/2026")                # Ngày tập huấn
        self.assertEqual(row[3], "14:00 - 16:30")             # Khung giờ
        self.assertEqual(row[4], "THCS Nguyễn Du")            # Đơn vị / Trường
        self.assertEqual(row[5], "Khối 6-7")                  # Lớp / Phân nhóm
        self.assertEqual(row[7], 2)                           # Buổi số
        self.assertEqual(row[8], 5)                           # Tổng số buổi
        self.assertEqual(row[10], "Thầy Nguyễn Văn A")        # Giảng viên chính
        self.assertEqual(row[11], "Cô Trần B")                # Trợ giảng
        self.assertEqual(row[13], 45)                         # Số học viên
        self.assertEqual(row[14], "Đã hoàn thành")            # Trạng thái
        self.assertEqual(row[15], "Lớp tiếp thu tốt")         # Ghi chú

    @patch("digital_training.training_sheet_sync.build_sheets_service")
    def test_import_updates_session_from_sheet(self, mock_build):
        mock_service = MagicMock()
        mock_build.return_value = mock_service

        # Mock Sheet row data edit: ngày mới, đổi giảng viên, số học viên tăng lên 52
        mock_rows = [
            [
                1,
                self.session.id,
                "30/10/2026",
                "15:00 - 17:00",
                "THCS Nguyễn Du",
                "Khối 6-7",
                "Nội dung",
                2,
                5,
                "2/5",
                "Thầy Lê Văn C",
                "Cô Trần B",
                "Google Meet",
                52,
                "Đã hoàn thành",
                "Ghi chú mới từ Sheet",
            ]
        ]
        mock_service.spreadsheets().values().get().execute.return_value = {"values": mock_rows}

        res = import_training_sessions_from_sheet(start_row=3, end_row=3)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["updated"], 1)

        self.session.refresh_from_db()
        self.assertEqual(self.session.session_date, datetime.date(2026, 10, 30))
        self.assertEqual(self.session.start_time, datetime.time(15, 0))
        self.assertEqual(self.session.end_time, datetime.time(17, 0))
        self.assertEqual(self.session.instructor_name, "Thầy Lê Văn C")
        self.assertEqual(self.session.attendees, 52)
        self.assertEqual(self.session.location, "Google Meet")
        self.assertEqual(self.session.notes, "Ghi chú mới từ Sheet")
