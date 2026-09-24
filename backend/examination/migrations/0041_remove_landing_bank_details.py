from django.db import migrations


BANK_KEYS = ('bankName', 'accountName', 'accountNumber', 'transferNote')


def remove_bank_details(apps, schema_editor):
    for model_name in ('LandingSite', 'LandingTemplate'):
        model = apps.get_model('examination', model_name)
        for instance in model.objects.all().iterator():
            content = instance.content
            if not isinstance(content, dict):
                continue
            registration = content.get('registration')
            if not isinstance(registration, dict):
                continue
            cleaned = {key: value for key, value in registration.items() if key not in BANK_KEYS}
            if len(cleaned) != len(registration):
                instance.content = {**content, 'registration': cleaned}
                instance.save(update_fields=['content'])


class Migration(migrations.Migration):
    dependencies = [('examination', '0040_link_2026_2027_exam_tabs')]
    operations = [migrations.RunPython(remove_bank_details, migrations.RunPython.noop)]
