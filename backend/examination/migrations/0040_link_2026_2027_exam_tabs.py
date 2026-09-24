from django.db import migrations
from django.utils import timezone


SHEET_URL = 'https://docs.google.com/spreadsheets/d/11h9E1WPewoUzoMK8UToIC2oJqRyFrvrw5oZfl81NZM8/edit'
TABS = (
    ('iaio-2026-2027', 'SCO - SIAIO'),
    ('ibo-2026-2027', 'SCO - SIBO'),
    ('icho-2026-2027', 'SCO - SIChO'),
    ('ipho-2026-2027', 'SCO - SIPhO'),
    ('ilso-2026-2027', 'SCO - SILSO'),
    ('fimo-2026-2027', 'FT - FIMO'),
    ('fieo-2026-2027', 'FT - FIEO'),
)


def link_tabs(apps, schema_editor):
    ExamSession = apps.get_model('examination', 'ExamSession')
    ExaminationSheet = apps.get_model('examination', 'ExaminationSheet')
    now = timezone.now()
    for session_id, tab_name in TABS:
        if not ExamSession.objects.filter(pk=session_id).exists():
            continue
        ExamSession.objects.filter(pk=session_id).update(
            registration_sheet_url=SHEET_URL,
            registration_sheet_tab=tab_name,
            updated_at=now,
        )
        sheet = ExaminationSheet.objects.filter(
            session_id=session_id, stage='registration-source',
        ).first()
        if sheet is None:
            ExaminationSheet.objects.create(
                id=f'2026-2027-{session_id}',
                session_id=session_id,
                stage='registration-source',
                name=tab_name,
                url=SHEET_URL,
                sheet_tab=tab_name,
                created_at=now,
                updated_at=now,
            )
        elif (sheet.url, sheet.sheet_tab) != (SHEET_URL, tab_name):
            sheet.name = tab_name
            sheet.url = SHEET_URL
            sheet.sheet_tab = tab_name
            sheet.status = 'idle'
            sheet.automation_enabled = False
            sheet.last_observed_fingerprint = ''
            sheet.pending_manual_import = False
            sheet.change_detected_at = None
            sheet.last_error = ''
            sheet.updated_at = now
            sheet.save()


class Migration(migrations.Migration):
    dependencies = [('examination', '0039_sheet_change_alert')]

    operations = [migrations.RunPython(link_tabs, migrations.RunPython.noop)]
