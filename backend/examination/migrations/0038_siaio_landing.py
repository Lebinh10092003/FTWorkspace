from django.db import migrations
from examination.landing_templates import siaio_content


def seed_siaio(apps, schema_editor):
    LandingTemplate = apps.get_model('examination', 'LandingTemplate')
    LandingSite = apps.get_model('examination', 'LandingSite')
    content = siaio_content()
    LandingTemplate.objects.get_or_create(
        key='siaio',
        defaults={'name': 'Mẫu SIAIO · AI',
                  'description': 'Bố cục riêng cho SIAIO với bộ chọn môn và lớp để xem đề mẫu.',
                  'layout': 'siaio', 'content': content, 'is_system': True},
    )
    LandingSite.objects.get_or_create(
        slug='siaio',
        defaults={'title': 'SIAIO · SCO International AI Olympiad',
                  'template': 'siaio', 'layout': 'siaio', 'content': content,
                  'published': False},
    )


class Migration(migrations.Migration):
    dependencies = [('examination', '0037_olympiad_schedule_2026_2027')]
    operations = [migrations.RunPython(seed_siaio, migrations.RunPython.noop)]
