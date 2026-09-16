import re

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from work_schedule.models import WorkItem
from work_schedule.sheet_parser import parse_sheet_tasks
from work_schedule.sheet_sync import (
    SHEET_NAME,
    TWO_WAY_SYNC_LEASE_SECONDS,
    _cell,
    _column_letter,
    _parse_date,
    _rows,
    _service,
    _sheet_columns,
    _spreadsheet_id,
    ensure_sync_columns,
    sync_lease,
)
from work_schedule.signals import suppress_sheet_queue
from work_schedule.training_sync import delete_training_for_work_item


def _content_key(value):
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


class Command(BaseCommand):
    help = "Xác minh và xóa các nhiệm vụ bị gắn nhầm người/ngày do lệch metadata Sheet."

    def add_arguments(self, parser):
        parser.add_argument("--record-id", action="append", required=True)
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        record_ids = list(dict.fromkeys(value.strip() for value in options["record_id"] if value.strip()))
        if not record_ids:
            raise CommandError("Cần ít nhất một WEB_RECORD_ID.")

        service = _service()
        columns = ensure_sync_columns(service)
        rows = list(enumerate(_rows(service, 2), start=2))
        plans = []
        for record_id in record_ids:
            matches = [(number, row) for number, row in rows if _cell(row, 8) == record_id]
            if len(matches) != 1:
                raise CommandError(f"{record_id}: cần đúng một dòng Sheet, tìm thấy {len(matches)}.")
            row_number, row = matches[0]
            content = _cell(row, 4)
            parsed_titles = [task.title for task in parse_sheet_tasks(content)]
            if not content or not parsed_titles:
                raise CommandError(f"{record_id}: dòng không có nội dung nhiệm vụ để đối chiếu.")
            content_key = _content_key(content)
            canonical = [
                (other_number, other)
                for other_number, other in rows
                if other_number != row_number
                and _content_key(_cell(other, 4)) == content_key
                and _cell(other, 8) != record_id
                and (_cell(other, 3), _parse_date(_cell(other, 1)))
                    != (_cell(row, 3), _parse_date(_cell(row, 1)))
            ]
            if not canonical:
                raise CommandError(f"{record_id}: không tìm thấy dòng gốc trùng khớp ở người/ngày khác.")
            items = list(WorkItem.objects.filter(source_record_id=record_id).order_by("daily_order", "id"))
            if sorted(_content_key(item.title) for item in items) != sorted(_content_key(title) for title in parsed_titles):
                raise CommandError(f"{record_id}: dữ liệu DB không khớp hoàn toàn với nội dung Sheet; dừng an toàn.")
            plans.append((record_id, row_number, items))

        task_count = sum(len(items) for _, _, items in plans)
        if not options["apply"]:
            self.stdout.write(self.style.WARNING(
                f"DRY RUN: verified_records={len(plans)} tasks={task_count} rows="
                + ",".join(str(row_number) for _, row_number, _ in plans)
            ))
            return

        with sync_lease(seconds=TWO_WAY_SYNC_LEASE_SECONDS) as acquired:
            if not acquired:
                raise CommandError("Đồng bộ Sheet đang chạy; hãy thử lại sau.")
            spreadsheet_id = _spreadsheet_id()
            clear_columns = [
                columns[name] for name in ("content", "self_notes", "leader_notes", "record_id", "task_ids", "sync_hash")
            ]
            clear_ranges = [
                f"'{SHEET_NAME}'!{_column_letter(column)}{row_number}"
                for _, row_number, _ in plans for column in clear_columns
            ]
            service.spreadsheets().values().batchClear(
                spreadsheetId=spreadsheet_id, body={"ranges": clear_ranges}
            ).execute()
            with transaction.atomic(), suppress_sheet_queue():
                for _, _, items in plans:
                    for item in items:
                        delete_training_for_work_item(item)
                        item.delete()

        self.stdout.write(self.style.SUCCESS(
            f"REPAIRED: records={len(plans)} tasks={task_count} rows="
            + ",".join(str(row_number) for _, row_number, _ in plans)
        ))
