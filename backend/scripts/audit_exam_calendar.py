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

def emit(label, value):
    print(label + ' ' + json.dumps(value, ensure_ascii=False, default=str))

emit('competitions', list(Competition.objects.values('id', 'code', 'organizer', 'parent')))
emit('sessions', list(ExamSession.objects.filter(id__contains='2026-2027').values(
    'id', 'code', 'name', 'organizer', 'parent', 'rounds', 'national_date', 'international_date')))
emit('exam_staff', [{'email': p.email, 'name': p.name} for p in examination_staff()])
config = SystemConfig.objects.filter(key='monthly_sheet_links').first()
emit('calendar_links', (config.data or {}).get('links', {}).get('work_schedule', {}) if config else {})
emit('future_exam_items', list(WorkItem.objects.filter(work_date__gte='2026-11-01',
    source_record_id__startswith='REC-EXAM-').values('id', 'executor_id', 'title', 'work_date',
    'source_record_id', 'source_sheet_row', 'status', 'progress_note')))
