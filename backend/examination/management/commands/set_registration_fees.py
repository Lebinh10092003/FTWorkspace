"""Điền lệ phí và hạn đăng ký vào các vòng thi theo quy tắc chủ dự án chốt 12/11/2026.

- SCO (mã công khai bắt đầu bằng SI): vòng loại 250.000đ, vòng chung kết quốc gia
  450.000đ, vòng quốc tế miễn phí. Kỳ chỉ có một vòng: 450.000đ.
- FIMO, FIEO: vòng loại 250.000đ, chung kết quốc gia 450.000đ, quốc tế thông báo sau.
- WAICY: lệ phí thông báo sau. AYSBC và các cuộc thi khác: không đụng tới.
- Hạn đăng ký từng đợt lấy từ tab "Danh sách các kỳ thi năm 2026-2027" của Sheet
  Khảo thí 2026-2027 (FIMO, FIEO, SIAIO).

Chỉ điền ô còn trống, không ghi đè giá trị đã khai trên web. Mặc định chỉ liệt kê;
thêm --apply để sao lưu DB rồi ghi.
"""
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import transaction

from examination.models import ExamSession
from examination.registration_window import candidate_sessions, phase_open, session_offer

QUALIFIER, NATIONAL_FINAL, INTERNATIONAL = 'qualifier', 'national-final', 'international'
FEES = {
    'SCO': {QUALIFIER: 250_000, NATIONAL_FINAL: 450_000, INTERNATIONAL: 0, 'single': 450_000},
    'FERMAT': {QUALIFIER: 250_000, NATIONAL_FINAL: 450_000},
}
# Hạn đăng ký theo ngày thi của từng đợt (mã kỳ trên server không thống nhất).
BATCH_DEADLINES = {
    'FIMO': {'2026-10-11': '2026-10-04', '2026-12-06': '2026-11-29', '2027-02-28': '2027-02-21'},
    'FIEO': {'2026-10-18': '2026-10-04', '2026-12-13': '2026-11-29', '2027-03-07': '2027-02-21'},
    'SIAIO': {'2026-10-04': '2026-10-03', '2026-10-25': '2026-10-18'},
}
BACKUP_DIR = '/home/workspace/ft-workspace-data/backups'


def family(code):
    if code in ('FIMO', 'FIEO'):
        return 'FERMAT'
    if code.startswith('SI'):
        return 'SCO'
    return ''


def kind(name):
    text = str(name or '').casefold()
    if 'quốc tế' in text or 'international' in text:
        return INTERNATIONAL
    if 'loại' in text or 'qualif' in text or 'preliminary' in text:
        return QUALIFIER
    if 'quốc gia' in text or 'national' in text:
        return NATIONAL_FINAL
    return ''


def planned_rounds(session, code):
    rounds = [dict(item) for item in (session.rounds or []) if isinstance(item, dict)]
    fees = FEES.get(family(code), {})
    changes = []
    named = [item for item in rounds if str(item.get('name') or '').strip()]
    for index, item in enumerate(rounds):
        if not str(item.get('name') or '').strip():
            continue
        fee = fees.get('single') if len(named) == 1 and 'single' in fees else fees.get(kind(item.get('name')))
        if fee is not None and item.get('fee') in (None, ''):
            item['fee'] = fee
            changes.append(f"{item['name']}: " + ('miễn phí' if fee == 0 else f'lệ phí {fee:,}đ'.replace(',', '.')))
        if index == 0 and code in BATCH_DEADLINES:
            slots = [dict(slot) for slot in item.get('slots') or [] if isinstance(slot, dict)]
            for position, slot in enumerate(slots):
                deadline = BATCH_DEADLINES[code].get(str(slot.get('date') or '').strip())
                if deadline and not slot.get('registrationDeadline'):
                    slot['registrationDeadline'] = deadline
                    changes.append(f"{item['name']} đợt {position + 1} (thi {slot['date']}): hạn đăng ký {deadline}")
            item['slots'] = slots
    return rounds, changes


class Command(BaseCommand):
    help = 'Điền lệ phí và hạn đăng ký theo đợt cho các kỳ đang tuyển sinh (chỉ ô trống).'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Sao lưu DB rồi ghi thay đổi.')

    def handle(self, *args, **options):
        plans, skipped = [], []
        for code, session, _name in candidate_sessions():
            if not phase_open(session.phase):
                if family(code) or code == 'WAICY':
                    skipped.append(f'{code} ({session.id}): giai đoạn "{session.phase}" đã qua tuyển sinh, không hiện trên form')
                continue
            if session_offer(session)['status'] == 'expired':
                skipped.append(f'{code} ({session.id}): đã hết hạn đăng ký, giữ nguyên')
                continue
            if not family(code):
                skipped.append(f'{code} ({session.id}): không có quy tắc lệ phí, giữ nguyên')
                continue
            rounds, changes = planned_rounds(session, code)
            if changes:
                plans.append((session, rounds, changes))
            else:
                skipped.append(f'{code} ({session.id}): đã đủ lệ phí/hạn, không cần điền')
        for session, _rounds, changes in plans:
            self.stdout.write(f'{session.id} · {session.name} · giai đoạn "{session.phase}"')
            for change in changes:
                self.stdout.write(f'  + {change}')
        for line in skipped:
            self.stdout.write(f'  = {line}')
        if not plans:
            self.stdout.write('Không có ô nào cần điền.')
            return
        if not options['apply']:
            self.stdout.write(f'Chạy thử: {len(plans)} kỳ sẽ được cập nhật. Thêm --apply để ghi.')
            return
        if Path(BACKUP_DIR).parent.exists():
            call_command('backup_workspace_db', destination=BACKUP_DIR, keep=60)
            self.stdout.write(f'Đã sao lưu DB vào {BACKUP_DIR}.')
        with transaction.atomic():
            for session, rounds, _changes in plans:
                ExamSession.objects.filter(pk=session.pk).update(rounds=rounds)
        self.stdout.write(f'Đã cập nhật {len(plans)} kỳ.')
