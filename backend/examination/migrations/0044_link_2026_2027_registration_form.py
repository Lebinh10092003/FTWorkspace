from django.db import migrations
from django.utils import timezone


SHEET_URL = 'https://docs.google.com/spreadsheets/d/1gqO1Tp4YSBp0UVBgXjJgvL8CuqftVKGNd74PPRX9i8E/edit'
SOURCES = (
    ('iaio-2026-2027', 'SIAIO'),
    ('ipho-2026-2027', 'SIPhO, SIChO, SIBO, SILSO'),
    ('icho-2026-2027', 'SIPhO, SIChO, SIBO, SILSO'),
    ('ibo-2026-2027', 'SIPhO, SIChO, SIBO, SILSO'),
    ('ilso-2026-2027', 'SIPhO, SIChO, SIBO, SILSO'),
    ('fimo-2026-2027', 'FIMO, FIEO'),
    ('fieo-2026-2027', 'FIMO, FIEO'),
)


def link_form(apps, schema_editor):
    Session = apps.get_model('examination', 'ExamSession')
    Sheet = apps.get_model('examination', 'ExaminationSheet')
    now = timezone.now()
    for session_id, tab in SOURCES:
        session = Session.objects.filter(pk=session_id).first()
        if not session:
            continue
        session.registration_sheet_url = SHEET_URL
        session.registration_sheet_tab = tab
        session.save(update_fields=['registration_sheet_url', 'registration_sheet_tab'])
        Sheet.objects.update_or_create(
            id=f'form-2026-2027-{session_id}',
            defaults={
                'name': f'Form đăng ký {session.code} 2026–2027', 'url': SHEET_URL,
                'status': 'idle', 'session_id': session_id, 'sheet_tab': tab,
                'stage': 'form-webhook', 'automation_enabled': True,
                'created_at': now, 'updated_at': now, 'created_by': 'Hệ thống',
            },
        )


class Migration(migrations.Migration):
    dependencies = [('examination', '0043_formregistrationlink_and_more')]
    operations = [migrations.RunPython(link_form, migrations.RunPython.noop)]
