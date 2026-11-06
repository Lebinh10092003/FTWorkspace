"""Read only calendar audit; never prints credentials or candidate records."""
import json
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
import django
django.setup()
from authentication.models import SystemConfig, UserProfile
from examination.models import Competition, ExamSession
from examination.work_schedule_sync import examination_staff
from work_schedule.models import WorkItem

expected = {'iaio': '2026-11-29', 'ilso': '2026-11-29',
            'ibo': '2026-11-22', 'icho': '2026-11-22', 'ipho': '2026-11-22'}
sessions = list(ExamSession.objects.filter(id__in=[f'{key}-2026-2027' for key in expected]))
finals = [next((r for r in (s.rounds or []) if r.get('id') == 'round-final'), {}) for s in sessions]
correct = sum(r.get('date') == expected[s.competition_id] for s, r in zip(sessions, finals))
organizers = set((s.organizer or Competition.objects.get(pk=s.competition_id).organizer).strip().casefold() for s in sessions)
target = {'thuanld@fermat.edu.vn', 'dungpv@fermat.edu.vn', 'phongnt@fermat.edu.vn', 'phuongnt@fermat.edu.vn'}
staff = {p.email for p in examination_staff()}
future = WorkItem.objects.filter(work_date__gte='2026-11-01', source_record_id__startswith='REC-EXAM-')
print(json.dumps({'sessionsFound': len(sessions), 'roundsFound': sum(bool(r) for r in finals),
    'correctNewDates': correct, 'sharedOrganizer': len(organizers) == 1 and bool(next(iter(organizers), '')),
    'departmentStaffCount': len(staff), 'targetStaffPresent': UserProfile.objects.filter(email__in=target).count(),
    'futureGeneratedCount': future.count(), 'generated2027Count': future.filter(work_date__year=2027).count(),
    'oldNovemberGeneratedCount': future.filter(work_date__in=['2026-11-01','2026-11-08']).count(),
    'newNovemberGeneratedCount': future.filter(work_date__in=['2026-11-22','2026-11-29']).count()}, ensure_ascii=True))
