import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from authentication.models import UserProfile
from examination.models import ExamInvigilationShift, ExamSession

SHEET = 'https://docs.google.com/spreadsheets/d/1Kr9HBVbJEtRiwZv31o847dnrkQyZqYjn4kqPKxwpgzo/edit'
ROOM_STAFF = [('Mr Tiến', 'tienthm@fermat.edu.vn'), ('Ms Phương', 'phuongnt@fermat.edu.vn'),
              ('Mr Bình', 'binhlv@fermat.edu.vn'), ('Mr Phong', 'phongnt@fermat.edu.vn')]


def resolve_staff(label, email):
    # Exact identities verified in the Workspace employee directory, never guessed from first names.
    return UserProfile.objects.filter(email=email, employment_status='ACTIVE').first()


class Command(BaseCommand):
    help = 'Prepare the authorized 11/10/2026 FIMO demo without importing demo candidates into Khảo thí.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        session = ExamSession.objects.filter(pk='fimo-2026-2027').first()
        if not session:
            self.stdout.write('Không có kỳ FIMO 2026–2027; bỏ qua cấu hình demo.')
            return
        tz = ZoneInfo('Asia/Ho_Chi_Minh')
        resolved = [resolve_staff(*pair) for pair in ROOM_STAFF]
        for i, user in enumerate(resolved):
            self.stdout.write(f'Phòng {i+1}: {ROOM_STAFF[i][0]} → {user.name if user else "CHƯA XÁC ĐỊNH DUY NHẤT"}')
        if not options['apply']:
            return
        with transaction.atomic():
            for ca, (start, end) in enumerate([('09:00', '10:00'), ('10:30', '11:30')]):
                for room in range(4):
                    roster = []
                    for t in range(4):
                        number = ca*16 + room*4 + t + 1
                        roster.append({'code': f'DEMO-{number:03}', 'name': f'Thí sinh demo {number:03}',
                                       'school': f'Trường demo {room+1}', 'grade': str(room+1 if ca == 0 else room+5),
                                       'attendance': 'Chưa điểm danh', 'score': '', 'note': '',
                                       'sheetRow': 4 + ca*8 + t, 'revision': str(uuid.uuid4()),
                                       'sheetSnapshot': ['Chưa điểm danh', '', '']})
                    shift, created = ExamInvigilationShift.objects.get_or_create(
                        session=session, occurrence_id=f'vlqg-2026-10-11-ca-{ca+1}', room_number=str(room+1),
                        defaults={'round_name': 'Vòng loại Quốc gia', 'label': f'Ca {ca+1}',
                                  'starts_at': datetime.fromisoformat(f'2026-10-11T{start}:00').replace(tzinfo=tz),
                                  'ends_at': datetime.fromisoformat(f'2026-10-11T{end}:00').replace(tzinfo=tz),
                                  'invigilator_label': ROOM_STAFF[room][0], 'sheet_url': SHEET,
                                  'sheet_tab': f'Phòng {room+1}', 'roster': roster, 'demo': True},
                    )
                    # Deploys never overwrite a room, roster or assignment already reviewed by an operator.
                    if created and resolved[room]:
                        shift.invigilators.set([resolved[room]])
                    self.stdout.write(f'{shift.label} / Phòng {room+1}: {"created" if created else "kept"}')
        self.stdout.write('Link: https://workspace.fermat.vn/examination/invigilation/fimo-2026-2027')
