from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('examination', '0061_refresh_november_landing_registration')]
    operations = [migrations.CreateModel(
        name='LandingHubSettings',
        fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('content', models.JSONField(default=dict)),
            ('updated_by', models.CharField(blank=True, default='', max_length=255)),
            ('updated_at', models.DateTimeField(auto_now=True)),
        ],
    )]
