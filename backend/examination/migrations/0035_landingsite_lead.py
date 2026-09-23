from django.db import migrations, models
import django.db.models.deletion
from examination.landing_templates import olympiad_content


def seed_olympiads(apps, schema_editor):
    LandingSite = apps.get_model('examination', 'LandingSite')
    for code in ('FIMO', 'FIEO'):
        LandingSite.objects.get_or_create(
            slug=code.lower(),
            defaults={
                'title': f'{code} · Fermat International {"Mathematics" if code == "FIMO" else "English"} Olympiad',
                'template': 'olympiad', 'content': olympiad_content(code),
                'published': True,
            },
        )


class Migration(migrations.Migration):
    dependencies = [('examination', '0034_competitionlandingpage')]

    operations = [
        migrations.CreateModel(
            name='LandingSite',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('slug', models.SlugField(max_length=120, unique=True)),
                ('title', models.CharField(max_length=300)),
                ('template', models.CharField(default='custom', max_length=40)),
                ('content', models.JSONField(default=dict)),
                ('published', models.BooleanField(default=False)),
                ('updated_by', models.CharField(blank=True, default='', max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'ordering': ['title']},
        ),
        migrations.CreateModel(
            name='LandingLead',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('full_name', models.CharField(max_length=200)),
                ('phone', models.CharField(max_length=40)),
                ('email', models.EmailField(blank=True, default='', max_length=254)),
                ('school_city', models.CharField(blank=True, default='', max_length=300)),
                ('message', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('site', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='leads', to='examination.landingsite')),
            ],
        ),
        migrations.RunPython(seed_olympiads, migrations.RunPython.noop),
    ]
