from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('examination', '0038_siaio_landing')]
    operations = [
        migrations.AddField(model_name='examinationsheet', name='last_observed_fingerprint',
                            field=models.CharField(max_length=80, blank=True, default='')),
        migrations.AddField(model_name='examinationsheet', name='change_detected_at',
                            field=models.DateTimeField(null=True, blank=True)),
    ]
