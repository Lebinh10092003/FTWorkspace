"""Xóa định dạng in đậm/nghiêng bị "lây" từ nhiệm vụ đứng trước.

Một lỗi cũ ở ``_build_content_format_runs`` không đặt lại định dạng ở đầu dòng
sau khi ghi rich text của một nhiệm vụ được đánh dấu thủ công. Google Sheets giữ
nguyên run đó tới hết ô, nên mọi nhiệm vụ đứng sau đều hiển thị đậm/nghiêng và
trạng thái sai đó được ghi ngược vào cơ sở dữ liệu.

Bản vá ở ``sheet_sync`` chặn lỗi tái diễn nhưng không tự sửa những dòng đã lưu:
chúng có ``title_format_runs``/``sheet_emphasis`` riêng nên vòng đồng bộ kế tiếp
lại ghi đúng trạng thái đậm đó ra Sheet. Lệnh này dọn phần dữ liệu tồn đọng theo
đúng quy tắc nghiệp vụ: chỉ nhiệm vụ mở đầu bằng giờ (hoặc được đánh dấu quan
trọng một cách độc lập) mới được in đậm và nghiêng.
"""

from collections import defaultdict

from django.core.management.base import BaseCommand, CommandError
from django.utils.dateparse import parse_date

from work_schedule.models import WorkItem
from work_schedule.rich_text import format_state_at, normalize_format_runs, utf16_length
from work_schedule.sheet_parser import is_personal_task


def _rendered_bold(item):
    """Trạng thái đậm mà web và Sheet đang hiển thị cho một nhiệm vụ."""
    runs = normalize_format_runs(item.title_format_runs, utf16_length(item.title))
    if runs is not None:
        return bool(format_state_at(runs, 0)["bold"])
    if item.sheet_emphasis is not None:
        return bool(item.sheet_emphasis)
    return item.priority == "high" and not is_personal_task(item.title)


class Command(BaseCommand):
    help = "Bỏ in đậm/nghiêng bị lây sang các nhiệm vụ đứng sau trong cùng một ngày."

    def add_arguments(self, parser):
        parser.add_argument("--start", help="Ngày bắt đầu (YYYY-MM-DD).")
        parser.add_argument("--end", help="Ngày kết thúc (YYYY-MM-DD).")
        parser.add_argument("--email", help="Chỉ xử lý một nhân sự.")
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Ghi thay đổi. Không có cờ này lệnh chỉ liệt kê nhiệm vụ sẽ sửa.",
        )

    def handle(self, *args, **options):
        items = WorkItem.objects.all()
        for name in ("start", "end"):
            raw = options.get(name)
            if not raw:
                continue
            parsed = parse_date(raw)
            if not parsed:
                raise CommandError(f"Giá trị --{name} không phải ngày hợp lệ: {raw}")
            items = items.filter(**{f"work_date__{'gte' if name == 'start' else 'lte'}": parsed})
        if options.get("email"):
            items = items.filter(executor_id=options["email"].strip().lower())

        groups = defaultdict(list)
        for item in items.order_by("work_date", "daily_order", "start_time", "pk"):
            groups[(item.executor_id, item.work_date)].append(item)

        repaired = []
        for (email, work_date), group in sorted(groups.items()):
            previous_bold = False
            for item in group:
                bold = _rendered_bold(item)
                # Nhiệm vụ mở đầu bằng giờ tự có quyền in đậm, nhiệm vụ lịch cá
                # nhân không bao giờ in đậm và luôn được model chuẩn hóa lại.
                leaked = (
                    bold
                    and previous_bold
                    and not item.time_prefix_in_title
                    and not is_personal_task(item.title)
                )
                if leaked:
                    item.title_format_runs = []
                    item.sheet_emphasis = None
                    item.priority = "medium"
                    item.priority_before_time = None
                    repaired.append((email, work_date, item))
                # Giữ trạng thái đậm trước khi sửa: cả đuôi danh sách cùng thừa
                # hưởng một run duy nhất, nên nhiệm vụ kế tiếp vẫn phải bị coi
                # là lây định dạng chứ không dừng lại ở nhiệm vụ đầu tiên.
                previous_bold = bold

        for email, work_date, item in repaired:
            self.stdout.write(
                f"{work_date} · {email} · #{item.daily_order} · {item.title[:70]}"
            )
        if not repaired:
            self.stdout.write(self.style.SUCCESS("Không có nhiệm vụ nào bị lây định dạng."))
            return

        if not options["apply"]:
            self.stdout.write(self.style.WARNING(
                f"{len(repaired)} nhiệm vụ sẽ được bỏ in đậm. Chạy lại với --apply để ghi."
            ))
            return

        for _email, _work_date, item in repaired:
            item.save(update_fields=[
                "title_format_runs", "sheet_emphasis", "priority",
                "priority_before_time", "updated_at",
            ])
        self.stdout.write(self.style.SUCCESS(
            f"Đã sửa {len(repaired)} nhiệm vụ và xếp hàng đồng bộ lại ra Sheet."
        ))
