import zipfile
from datetime import date
from io import BytesIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.authtoken.models import Token

from authentication.models import UserProfile

from .funding_proposal import build_funding_proposal
from .numbering import (
    derive_type_code,
    format_number,
    issue_number,
    register_state,
    sequence_of,
    type_code_for,
    weekday_label,
)

# The register as it really looks: banner row, header row, then the entries.
REGISTER_ROWS = [
    ["SỐ LẤY SỐ VĂN BẢN "],
    ["Thứ", "Thời gian", "Số văn bản", "Loại văn bản", "Nội dung công việc", "Người soạn", "Người ký"],
    ["Năm", "10/09/2026", "40/FT", "Công văn", "V/v tổ chức các cuộc thi", "Mr Phong", "Mr Thuận"],
    ["Tư", "16/09/2026", "45/QĐ-FT", "Quyết định", "V/v công nhận hoàn thành", "Ms Phương", "Mr Thuận"],
]


class FakeValues:
    def __init__(self, sheet):
        self.sheet = sheet

    def get(self, **kwargs):
        return mock.Mock(execute=mock.Mock(return_value={"values": self.sheet.rows}))

    def append(self, **kwargs):
        self.sheet.appended.append(kwargs["body"]["values"][0])
        self.sheet.rows = self.sheet.rows + kwargs["body"]["values"]
        row_number = len(self.sheet.rows)
        return mock.Mock(execute=mock.Mock(return_value={
            "updates": {"updatedRange": f"'Số văn bản'!A{row_number}:G{row_number}"}
        }))

    def update(self, **kwargs):
        self.sheet.updates.append((kwargs["range"], kwargs["body"]["values"][0][0]))
        return mock.Mock(execute=mock.Mock(return_value={}))


class FakeSpreadsheets:
    def __init__(self, sheet):
        self.sheet = sheet

    def get(self, **kwargs):
        return mock.Mock(execute=mock.Mock(return_value={
            "sheets": [{"properties": {"sheetId": 138890787, "title": "Số văn bản"}}]
        }))

    def values(self):
        return FakeValues(self.sheet)


class FakeSheet:
    def __init__(self, rows=None):
        self.rows = [list(row) for row in (rows if rows is not None else REGISTER_ROWS)]
        self.appended = []
        self.updates = []

    def service(self):
        return mock.Mock(spreadsheets=mock.Mock(return_value=FakeSpreadsheets(self)))


class DocumentNumberFormatTests(TestCase):
    def test_cong_van_carries_no_type_code(self):
        self.assertEqual(format_number(46, "Công văn"), "46/FT")

    def test_other_types_use_their_official_code(self):
        self.assertEqual(format_number(46, "Quyết định"), "46/QĐ-FT")
        self.assertEqual(format_number(46, "Báo cáo"), "46/BC-FT")
        self.assertEqual(format_number(46, "Thông báo"), "46/TB-FT")
        self.assertEqual(format_number(46, "Nghị định"), "46/NĐ-FT")

    def test_single_digit_numbers_are_padded_like_the_register(self):
        self.assertEqual(format_number(9, "Công văn"), "09/FT")

    def test_an_unknown_type_falls_back_to_its_initials(self):
        self.assertEqual(derive_type_code("Thư mời họp"), "TMH")
        self.assertEqual(type_code_for("Thư mời họp"), "TMH")

    def test_type_matching_ignores_case_and_accents(self):
        self.assertEqual(type_code_for("quyết định"), "QĐ")
        self.assertEqual(type_code_for("QUYẾT ĐỊNH"), "QĐ")

    def test_sequence_is_read_from_the_leading_digits(self):
        self.assertEqual(sequence_of("38/QĐ-FT"), 38)
        self.assertEqual(sequence_of("09/FT"), 9)
        self.assertIsNone(sequence_of("chưa cấp"))

    def test_weekday_follows_the_register_wording(self):
        self.assertEqual(weekday_label(date(2026, 9, 21)), "Hai")
        self.assertEqual(weekday_label(date(2026, 9, 23)), "Tư")
        self.assertEqual(weekday_label(date(2026, 9, 27)), "CN")


class DocumentNumberRegisterTests(TestCase):
    def setUp(self):
        self.sheet = FakeSheet()

    def test_next_number_is_one_past_the_largest_in_the_sheet(self):
        with mock.patch("documents.numbering._service", return_value=self.sheet.service()):
            state = register_state()
        self.assertEqual(state["latest"], 45)
        self.assertEqual(state["next"], 46)
        self.assertEqual(state["sheetTitle"], "Số văn bản")
        self.assertEqual(state["recent"][0]["number"], "45/QĐ-FT")

    def test_issuing_appends_a_full_row_to_the_register(self):
        with mock.patch("documents.numbering._service", return_value=self.sheet.service()):
            issued = issue_number(
                document_type="Quyết định",
                subject="V/v cấp giấy chứng nhận",
                drafter="Ms Phương",
                signer="Mr Thuận",
                issued_on="2026-09-21",
            )
        self.assertEqual(issued["number"], "46/QĐ-FT")
        self.assertFalse(issued["renumbered"])
        self.assertEqual(self.sheet.appended, [[
            "Hai", "21/09/2026", "46/QĐ-FT", "Quyết định",
            "V/v cấp giấy chứng nhận", "Ms Phương", "Mr Thuận",
        ]])

    def test_a_number_taken_concurrently_is_reissued(self):
        """Someone else wrote 46 between our read and our append."""
        sheet = FakeSheet()

        class RacingValues(FakeValues):
            def append(self, **kwargs):
                # Simulate the competing row landing first.
                self.sheet.rows.append(
                    ["Hai", "21/09/2026", "46/FT", "Công văn", "Việc khác", "Mr A", "Mr B"]
                )
                return super().append(**kwargs)

        spreadsheets = FakeSpreadsheets(sheet)
        spreadsheets.values = lambda: RacingValues(sheet)
        service = mock.Mock(spreadsheets=mock.Mock(return_value=spreadsheets))

        with mock.patch("documents.numbering._service", return_value=service):
            issued = issue_number(
                document_type="Quyết định", subject="V/v abc",
                drafter="Ms Phương", signer="Mr Thuận", issued_on="2026-09-21",
            )
        self.assertTrue(issued["renumbered"])
        self.assertEqual(issued["number"], "47/QĐ-FT")
        self.assertEqual(sheet.updates[-1][1], "47/QĐ-FT")

    def test_an_empty_register_starts_at_one(self):
        sheet = FakeSheet(rows=REGISTER_ROWS[:2])
        with mock.patch("documents.numbering._service", return_value=sheet.service()):
            state = register_state()
        self.assertEqual(state["next"], 1)


class DocumentNumberApiTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(
            username="clerk@example.com", email="clerk@example.com", password="StrongPassword9921"
        )
        UserProfile.objects.create(email="clerk@example.com", name="Clerk", role="EMPLOYEE", access_modules=[])
        self.token = Token.objects.create(user=user).key
        self.sheet = FakeSheet()

    def auth(self):
        return {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}

    def test_register_endpoint_previews_the_next_number(self):
        with mock.patch("documents.numbering._service", return_value=self.sheet.service()):
            response = self.client.get("/api/documents/numbers?documentType=Báo cáo", **self.auth())
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["preview"], "46/BC-FT")
        self.assertTrue(response.json()["documentTypes"])

    def test_issue_endpoint_requires_a_subject(self):
        response = self.client.post(
            "/api/documents/numbers/issue",
            {"documentType": "Công văn"},
            content_type="application/json",
            **self.auth(),
        )
        self.assertEqual(response.status_code, 400)

    def test_issue_endpoint_writes_and_returns_the_number(self):
        with mock.patch("documents.numbering._service", return_value=self.sheet.service()):
            response = self.client.post(
                "/api/documents/numbers/issue",
                {"documentType": "Công văn", "subject": "V/v abc", "drafter": "Mr Phong",
                 "signer": "Mr Thuận", "issuedOn": "2026-09-21"},
                content_type="application/json",
                **self.auth(),
            )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.json()["number"], "46/FT")
        self.assertEqual(len(self.sheet.appended), 1)

    def test_anonymous_callers_are_rejected(self):
        self.assertEqual(self.client.get("/api/documents/numbers").status_code, 401)


class FundingProposalDocxTests(TestCase):
    def payload(self):
        return {
            "documentNumber": "46/PĐXKP-FT",
            "issuedOn": "2026-09-21",
            "kind": "new",
            "proposer": "Nguyễn Văn A",
            "department": "Phòng Kỹ thuật",
            "project": "Trang bị máy chiếu phòng họp",
            "purpose": "Phục vụ họp giao ban",
            "approvalDeadline": "2026-09-30",
            "items": [
                {"description": "Máy chiếu", "unit": "Cái", "quantity": 2, "unitPrice": 12000000},
                {"description": "Dây HDMI", "unit": "Sợi", "quantity": 3, "unitPrice": 250000},
            ],
            "vatRate": 10,
            "otherCost": 500000,
            "paymentMethod": "transfer",
            "attachments": ["quote", "approval"],
            "decision": "approved",
        }

    def document_text(self, content):
        with zipfile.ZipFile(BytesIO(content)) as archive:
            return archive.read("word/document.xml").decode("utf-8")

    def test_it_produces_a_readable_docx(self):
        filename, content = build_funding_proposal(self.payload())
        self.assertTrue(filename.endswith(".docx"))
        self.assertIn("46-PĐXKP-FT", filename)
        with zipfile.ZipFile(BytesIO(content)) as archive:
            self.assertIn("word/document.xml", archive.namelist())

    def test_numeric_document_number_gets_the_fixed_suffix(self):
        payload = self.payload()
        payload["documentNumber"] = "46"
        filename, content = build_funding_proposal(payload)
        self.assertIn("46-PĐXKP-FT", filename)
        self.assertIn("Số: 46/PĐXKP-FT", self.document_text(content))

    def test_the_form_keeps_its_official_headings(self):
        _, content = build_funding_proposal(self.payload())
        xml = self.document_text(content)
        for heading in [
            "PHIẾU ĐỀ XUẤT KINH PHÍ",
            "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM",
            "1. Thông tin đề xuất",
            "2. Dự toán và phương án thực hiện",
            "3. Đối chiếu điều chỉnh và hồ sơ kèm theo",
            "4. Xác nhận và ý kiến kiểm tra",
            "5. Phê duyệt của người có thẩm quyền",
        ]:
            self.assertIn(heading, xml, heading)

    def test_totals_are_computed_from_the_line_items(self):
        _, content = build_funding_proposal(self.payload())
        xml = self.document_text(content)
        # 2 x 12.000.000 + 3 x 250.000 = 24.750.000
        self.assertIn("24.750.000", xml)
        # + 10% VAT (2.475.000) + 500.000 other = 27.725.000
        self.assertIn("2.475.000", xml)
        self.assertIn("27.725.000", xml)

    def test_ticked_boxes_reflect_the_choices(self):
        _, content = build_funding_proposal(self.payload())
        xml = self.document_text(content)
        self.assertIn("☒ Mới", xml)
        self.assertIn("☐ Điều chỉnh, bổ sung", xml)
        self.assertIn("☒ Chuyển khoản", xml)
        self.assertIn("☒ Báo giá đủ thuế/phí", xml)
        self.assertIn("☐ Quy cách/mẫu sản phẩm", xml)

    def test_an_empty_form_still_renders_a_printable_blank(self):
        filename, content = build_funding_proposal({})
        xml = self.document_text(content)
        self.assertIn("PHIẾU ĐỀ XUẤT KINH PHÍ", xml)
        self.assertIn("Số: ……/PĐXKP-FT", xml)
        self.assertTrue(filename.endswith(".docx"))

    def test_the_endpoint_returns_a_word_attachment(self):
        user = get_user_model().objects.create_user(
            username="a@example.com", email="a@example.com", password="StrongPassword9921"
        )
        UserProfile.objects.create(email="a@example.com", name="A", role="EMPLOYEE", access_modules=[])
        token = Token.objects.create(user=user).key
        response = self.client.post(
            "/api/documents/funding-proposal.docx",
            self.payload(),
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("wordprocessingml", response["Content-Type"])
        disposition = response["Content-Disposition"]
        # ASCII fallback plus the real Vietnamese name, not an RFC2047 blob.
        self.assertTrue(disposition.startswith("attachment;"), disposition)
        self.assertIn('filename="Phieu-de-xuat-kinh-phi-46-PDXKP-FT.docx"', disposition)
        self.assertIn("filename*=UTF-8''", disposition)
        self.assertGreater(len(response.content), 5000)
