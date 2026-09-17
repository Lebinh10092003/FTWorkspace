from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("work_schedule", "0016_personal_task_medium_priority")]

    operations = [
        migrations.AddField(
            model_name="workitem",
            name="sheet_emphasis",
            field=models.BooleanField(blank=True, null=True),
        ),
    ]
