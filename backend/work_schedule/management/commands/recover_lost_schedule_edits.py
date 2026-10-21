"""Gỡ các người–ngày Lịch công tác bị kẹt "xung đột" vì sửa trên Sheet không về web.

Webhook lỗi (403/429, server không gọi tới được) làm một sửa đổi trên Sheet
không bao giờ về web; từ đó mọi thay đổi trên web của người–ngày đó bị bỏ qua.
Lệnh nhập lại đúng dòng Sheet đó (Sheet thắng, như khi webhook về muộn) rồi ghi
phần web còn thiếu ra Sheet. Mặc định chỉ chạy thử và in ra web sẽ đổi gì;
thêm --apply để sao lưu DB rồi ghi.
"""

from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from examination.rooms_from_links import backup_database
from work_schedule.models import WorkItem, WorkScheduleSheetChange
from work_schedule.retention import retained_from
from work_schedule.sheet_sync import (
    _cell,
    _find_row,
    _known_row_hashes,
    _recover_lost_sheet_edit,
    _retained_sheet_start_row,
    _row_hash,
    _rows,
    _service,
    _sheet_name_email_map,
    _sheet_row_indexes,
    push_attendance_safely,
    push_groups_to_sheet,
    sync_lease,
    TWO_WAY_SYNC_LEASE_SECONDS,
)


def _items(email, work_date):
    return list(WorkItem.objects.filter(executor_id=email, work_date=work_date).order_by(
        "daily_order", "start_time", "created_at", "pk"))


class Command(BaseCommand):
    help = "Nhập lại các dòng Lịch công tác bị kẹt xung đột (Sheet thắng). Mặc định chỉ chạy thử."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=7, help="Xét các xung đột trong chừng này ngày.")
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        since = timezone.now() - timedelta(days=options["days"])
        stuck = WorkScheduleSheetChange.objects.filter(
            status=WorkScheduleSheetChange.STATUS_CONFLICT, processed_at__gte=since,
            work_date__gte=retained_from(),
        )
        groups = sorted(set(stuck.values_list("executor_email", "work_date")), key=lambda g: (g[1], g[0]))
        self.stdout.write(f"{len(groups)} người–ngày đang kẹt xung đột.")
        if not groups:
            return

        service = _service(None)
        rows_start = _retained_sheet_start_row(service, retained_from())
        rows = _rows(service, rows_start)
        row_index, uid_index = _sheet_row_indexes(rows, rows_start, _sheet_name_email_map())
        recoverable = set()
        for email, work_date in groups:
            items = _items(email, work_date)
            row_number, current = _find_row(rows, email, work_date, items, row_index, rows_start, uid_index)
            self.stdout.write(f"\n== {email} {work_date:%d/%m/%Y}: dòng {row_number}, web có {len(items)} việc")
            if not current:
                self.stdout.write("   Không tìm thấy dòng trên Sheet: bỏ qua.")
                continue
            live_hash = _row_hash(*(_cell(current, index) for index in (4, 5, 6, 9)))
            if live_hash in _known_row_hashes(current, items):
                self.stdout.write("   Dòng đã khớp với web: lượt ghi tới sẽ tự đi tiếp.")
                recoverable.add((email, work_date))
                continue
            before = {item.pk: item.title for item in items}
            with transaction.atomic():
                recovered = _recover_lost_sheet_edit(row_number, current, email, work_date)
                after = {item.pk: item for item in recovered or []}
                transaction.set_rollback(True)
            if recovered is None:
                self.stdout.write("   Không nhập được an toàn (mã việc trùng/sai người): giữ nguyên, cần xem tay.")
                continue
            recoverable.add((email, work_date))
            for item in recovered:
                origin = "Sheet" if item.source_sheet_row == row_number else "web, chưa lên Sheet, giữ lại"
                change = "" if before.get(item.pk) == item.title else (" (mới)" if item.pk not in before else " (đổi tên)")
                self.stdout.write(f"   {item.daily_order}. [{origin}]{change} {item.title[:80]}")
            for pk, title in before.items():
                if pk not in after:
                    self.stdout.write(f"   XÓA khỏi web (Sheet không còn): {title[:80]}")

        if not options["apply"]:
            self.stdout.write(f"\nChạy thử: chưa ghi gì. {len(recoverable)} người–ngày gỡ được. Thêm --apply để ghi.")
            return

        backup = backup_database()
        self.stdout.write(f"\nĐã sao lưu DB vào {backup}." if backup else "\nKhông sao lưu được DB trên máy này.")
        with sync_lease(seconds=TWO_WAY_SYNC_LEASE_SECONDS) as acquired:
            if not acquired:
                raise CommandError("Một lượt đồng bộ khác đang chạy, thử lại sau.")
            result = push_groups_to_sheet(service, recoverable, resolve_conflict_groups=recoverable)
            push_attendance_safely(service, recoverable)
        still = {(row["email"], row["date"]) for row in result["conflicts"]}
        done = [group for group in recoverable if (group[0], group[1].isoformat()) not in still]
        for email, work_date in done:
            stuck.filter(executor_email=email, work_date=work_date).update(
                status=WorkScheduleSheetChange.STATUS_DONE, processed_at=timezone.now(), last_error="",
            )
        self.stdout.write(f"Đã gỡ {len(done)} người–ngày; còn kẹt: {sorted(still) or 'không'}.")
