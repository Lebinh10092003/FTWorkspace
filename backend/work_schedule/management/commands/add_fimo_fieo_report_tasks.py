"""Thêm nhiệm vụ theo dõi tuyển sinh FIMO/FIEO vào Lịch công tác (yêu cầu 25/11/2026).

- 25/11: "Tạo bảng theo dõi tiến độ, số lượng tuyển sinh các đơn vị, đối tác cuộc thi FIMO, FIEO".
- 21h00 ngày 25/11, rồi 9h00 và 21h00 mỗi ngày 26–29/11: báo cáo ngắn gọn số lượng tuyển sinh.

Ưu tiên Vừa và không in đậm: nhiệm vụ có giờ ở đầu tiêu đề mặc định lên
ưu tiên Cao và in đậm trên Sheet, nên đặt rõ sheet_emphasis=False và định
dạng chữ rỗng (không đậm/nghiêng) để lần đồng bộ ngược từ Sheet giữ Vừa.

Mặc định chạy thử; --apply để ghi. Chạy lại không tạo trùng.
"""
import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Max

from authentication.models import UserProfile
from work_schedule.models import WorkItem
from work_schedule.sheet_parser import parse_sheet_tasks

EXECUTOR = 'phongnt@fermat.edu.vn'
TRACKER = 'Tạo bảng theo dõi tiến độ, số lượng tuyển sinh các đơn vị, đối tác cuộc thi FIMO, FIEO'
REPORT = 'Báo cáo ngắn gọn số lượng tuyển sinh các đơn vị, đối tác cuộc thi FIMO, FIEO'


def planned_tasks():
    tasks = [(datetime.date(2026, 11, 25), TRACKER), (datetime.date(2026, 11, 25), f'21h00: {REPORT}')]
    for day in range(26, 30):
        date = datetime.date(2026, 11, day)
        tasks += [(date, f'9h00: {REPORT}'), (date, f'21h00: {REPORT}')]
    return tasks


class Command(BaseCommand):
    help = 'Thêm nhiệm vụ theo dõi/báo cáo tuyển sinh FIMO, FIEO (25–29/11/2026) cho Mr Phong.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Ghi vào cơ sở dữ liệu (mặc định chỉ chạy thử).')

    def handle(self, *args, **options):
        executor = UserProfile.objects.filter(email=EXECUTOR).first()
        if not executor:
            raise CommandError(f'Không có tài khoản {EXECUTOR}.')
        mode = 'GHI' if options['apply'] else 'CHẠY THỬ'
        created = 0
        with transaction.atomic():
            for work_date, title in planned_tasks():
                if WorkItem.objects.filter(executor=executor, work_date=work_date, title=title).exists():
                    self.stdout.write(f'[{mode}] {work_date:%d/%m} đã có: {title}')
                    continue
                parsed = parse_sheet_tasks(f'1. {title}')[0]
                order = (WorkItem.objects.filter(executor=executor, work_date=work_date)
                         .aggregate(value=Max('daily_order'))['value'] or 0) + 1
                self.stdout.write(f'[{mode}] {work_date:%d/%m} #{order} · ưu tiên Vừa, không in đậm: {title}')
                if not options['apply']:
                    continue
                WorkItem.objects.create(
                    creator=executor, executor=executor, title=title, work_date=work_date,
                    status=WorkItem.STATUS_TODO, label='Công việc', daily_order=order,
                    start_time=parsed.start_time, end_time=parsed.end_time,
                    time_prefix_in_title=parsed.has_time_prefix,
                    priority='medium', priority_before_time='medium' if parsed.has_time_prefix else None,
                    sheet_emphasis=False, title_format_runs=[],
                )
                created += 1
        self.stdout.write(f'[{mode}] {"đã tạo" if options["apply"] else "sẽ tạo"} '
                          f'{created if options["apply"] else "các"} nhiệm vụ cho {executor.name or EXECUTOR}.')
