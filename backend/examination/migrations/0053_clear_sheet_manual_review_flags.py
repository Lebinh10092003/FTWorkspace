from django.db import migrations


def clear_flags(apps, schema_editor):
    # Sheet edits are now applied automatically; old review flags only kept a
    # stale banner on screen. Clearing the fingerprint makes the next scan
    # re-read each tab once and apply any edit still waiting.
    ExaminationSheet = apps.get_model('examination', 'ExaminationSheet')
    ExaminationSheet.objects.filter(pending_manual_import=True).update(
        pending_manual_import=False, change_detected_at=None, last_observed_fingerprint='', status='idle', last_error='',
    )


class Migration(migrations.Migration):
    dependencies = [('examination', '0052_school_import_and_transfer_proofs')]
    operations = [migrations.RunPython(clear_flags, migrations.RunPython.noop)]
