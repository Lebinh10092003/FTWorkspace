"""Bỏ in đậm/nghiêng ở ô "Nội dung công việc" của một nhân viên trong một ngày.

Dùng khi một ô bị đậm/nghiêng cả ô (sao chép dòng cũ, kế thừa định dạng dòng
trên...) mà không phải việc ưu tiên. Lệnh bỏ đậm/nghiêng của cả ô và mọi đoạn
chữ trong ô, giữ nguyên nội dung, rồi cho web đọc lại đúng dòng đó để web hiển
thị giống Sheet. Mặc định chỉ liệt kê; thêm --apply để ghi.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date

from examination.rooms_from_links import backup_database
from work_schedule.models import WorkItem
from work_schedule.rich_text import format_state_at
from work_schedule.sheet_sync import (
    SHEET_NAME,
    _cell,
    _column_letter,
    _ingest_row,
    _parse_date,
    _retained_sheet_start_row,
    _row_employee_email,
    _row_task_format_runs,
    _rows,
    _service,
    _sheet_name_email_map,
    _sheet_properties,
    _spreadsheet_id,
    ensure_sync_columns,
)
from work_schedule.signals import suppress_sheet_queue


def _describe(capture):
    if capture is None:
        return "không đọc được định dạng"
    return ", ".join(
        f"việc {index}: " + ("đậm" if state["bold"] else "thường") + (" nghiêng" if state["italic"] else "")
        for index, state in enumerate((format_state_at(runs, 0) for runs in capture), 1)
    ) or "ô trống"


class Command(BaseCommand):
    help = "Bỏ in đậm/nghiêng ở ô Nội dung công việc của một nhân viên trong một ngày."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--date", required=True, help="YYYY-MM-DD")
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        work_date = parse_date(options["date"])
        if not work_date:
            raise CommandError("Ngày phải có dạng YYYY-MM-DD.")
        service = _service(None)
        columns = ensure_sync_columns(service)
        rows_start = _retained_sheet_start_row(service, work_date)
        name_email_map = _sheet_name_email_map()
        matches = [
            (row_number, row)
            for row_number, row in enumerate(_rows(service, rows_start), start=rows_start)
            if _parse_date(_cell(row, 1)) == work_date and _row_employee_email(row, name_email_map) == email
        ]
        if len(matches) != 1:
            raise CommandError(f"Tìm thấy {len(matches)} dòng của {email} ngày {work_date}, cần đúng 1 dòng.")
        row_number, row = matches[0]
        cell = f"'{SHEET_NAME}'!{_column_letter(columns['content'])}{row_number}"
        self.stdout.write(f"Dòng {row_number} ({cell}):\n{_cell(row, 4)}")
        self.stdout.write(f"Định dạng hiện tại: {_describe(_row_task_format_runs(service, row_number, columns))}")
        if not options["apply"]:
            self.stdout.write("Chạy thử: chưa ghi gì. Thêm --apply để bỏ đậm/nghiêng.")
            return

        backup = backup_database()
        self.stdout.write(f"Đã sao lưu DB vào {backup}." if backup else "Không sao lưu được DB trên máy này.")
        service.spreadsheets().batchUpdate(
            spreadsheetId=_spreadsheet_id(),
            body={"requests": [{
                "updateCells": {
                    "range": {
                        "sheetId": _sheet_properties(service)["sheetId"],
                        "startRowIndex": row_number - 1,
                        "endRowIndex": row_number,
                        "startColumnIndex": columns["content"],
                        "endColumnIndex": columns["content"] + 1,
                    },
                    # Runs without bold/italic keep the (now plain) cell style,
                    # so clearing the runs leaves every task unformatted.
                    "rows": [{"values": [{
                        "userEnteredFormat": {"textFormat": {"bold": False, "italic": False}},
                        "textFormatRuns": [],
                    }]}],
                    "fields": "userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.italic,textFormatRuns",
                }
            }]},
        ).execute()
        capture = _row_task_format_runs(service, row_number, columns)
        self.stdout.write(f"Định dạng sau khi sửa: {_describe(capture)}")
        with transaction.atomic(), suppress_sheet_queue():
            _ingest_row(
                row_number,
                row,
                timezone.localdate(),
                task_format_runs=capture,
                sheet_authoritative=True,
                sheet_edited_at=timezone.now().isoformat(),
            )
        for item in WorkItem.objects.filter(executor_id=email, work_date=work_date).order_by("daily_order"):
            self.stdout.write(f"Web: {item.daily_order}. {item.title[:60]} -> ưu tiên {item.priority}, đậm={item.sheet_emphasis}")
