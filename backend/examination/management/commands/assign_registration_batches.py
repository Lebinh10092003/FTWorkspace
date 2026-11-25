"""Xếp bù đợt thi cho thí sinh đăng ký từ đợt 2 trở đi mà chưa có đợt.

Mặc định chỉ in kế hoạch (chạy thử). Thêm --apply để ghi. Chỉ điền đợt và
ngày thi vào kết quả vòng đầu còn trống; thí sinh Khảo thí đã xếp thì giữ nguyên,
nên chạy lại nhiều lần không đổi gì thêm.
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from examination.models import ExamSession
from examination.registration_batch import backfill_plan, place_in_batch

DEFAULT_SESSIONS = ('fimo-2026-2027', 'fieo-2026-2027')


class Command(BaseCommand):
    help = 'Xếp bù đợt thi (đợt + ngày thi) cho thí sinh đăng ký sau hạn đợt 1.'

    def add_arguments(self, parser):
        parser.add_argument('--session', action='append', dest='sessions', help='Mã kỳ tổ chức; mặc định FIMO, FIEO 2026–2027.')
        parser.add_argument('--apply', action='store_true', help='Ghi vào cơ sở dữ liệu (mặc định chỉ chạy thử).')

    def handle(self, *args, **options):
        session_ids = options['sessions'] or list(DEFAULT_SESSIONS)
        sessions = list(ExamSession.objects.filter(pk__in=session_ids))
        missing = sorted(set(session_ids) - {session.pk for session in sessions})
        for session_id in missing:
            self.stdout.write(f'Bỏ qua {session_id}: không có kỳ tổ chức này.')
        plan, skipped = backfill_plan(sessions)
        mode = 'GHI' if options['apply'] else 'CHẠY THỬ'
        self.stdout.write(f'[{mode}] {len(plan)} thí sinh cần xếp đợt · bỏ qua: '
                          f"{skipped['batch1']} đăng ký trong đợt 1, {skipped['placed']} đã có đợt, "
                          f"{skipped['school']} thuộc nhóm trường, {skipped['closed']} ngoài hạn đăng ký")
        counts = {}
        for participation, _entry, number, day in plan:
            key = (participation.session_id, number, day.isoformat())
            counts[key] = counts.get(key, 0) + 1
        for (session_id, number, day), count in sorted(counts.items()):
            self.stdout.write(f'  {session_id} · đợt {number} (thi {day}): {count} thí sinh')
        if not options['apply']:
            return
        with transaction.atomic():
            written = sum(1 for participation, entry, _number, day in plan if place_in_batch(participation, entry, day))
        self.stdout.write(f'Đã xếp đợt cho {written} thí sinh.')
