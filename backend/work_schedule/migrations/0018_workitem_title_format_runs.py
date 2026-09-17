from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("work_schedule", "0017_workitem_sheet_emphasis")]

    operations = [
        migrations.AddField(
            model_name="workitem",
            name="title_format_runs",
            field=models.JSONField(blank=True, default=None, null=True),
        ),
    ]
