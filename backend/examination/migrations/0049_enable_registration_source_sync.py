from django.db import migrations
from django.utils import timezone


def enable_registration_sources(apps, schema_editor):
    Sheet = apps.get_model('examination', 'ExaminationSheet')
    targets = {
        'iaio-2026-2027': 'SCO - SIAIO', 'ibo-2026-2027': 'SCO - SIBO',
        'icho-2026-2027': 'SCO - SIChO', 'ipho-2026-2027': 'SCO - SIPhO',
        'ilso-2026-2027': 'SCO - SILSO', 'fimo-2026-2027': 'FT - FIMO',
        'fieo-2026-2027': 'FT - FIEO',
    }
    for session_id, tab in targets.items():
        Sheet.objects.filter(session_id=session_id, sheet_tab=tab, stage='registration-source',
            url__contains='11h9E1WPewoUzoMK8UToIC2oJqRyFrvrw5oZfl81NZM8').update(
                automation_enabled=True, last_observed_fingerprint='', updated_at=timezone.now())


class Migration(migrations.Migration):
    dependencies = [('examination', '0048_detach_placeholder_registrations')]
    operations = [migrations.RunPython(enable_registration_sources, migrations.RunPython.noop)]
