from django.db import migrations

from examination.landing_templates import SCO_SUBJECTS, sco_content


def seed_sco_landings(apps, schema_editor):
    LandingSite = apps.get_model('examination', 'LandingSite')
    for code, data in SCO_SUBJECTS.items():
        # Chỉ tạo khi chưa có; trang đã chỉnh trong Landing Studio thì giữ nguyên.
        LandingSite.objects.get_or_create(
            slug=data['slug'],
            defaults={'title': data['title'], 'template': 'siaio', 'layout': 'siaio',
                      'content': sco_content(code), 'published': True},
        )


class Migration(migrations.Migration):
    dependencies = [('examination', '0056_round_eligibility_no_default')]
    operations = [migrations.RunPython(seed_sco_landings, migrations.RunPython.noop)]
