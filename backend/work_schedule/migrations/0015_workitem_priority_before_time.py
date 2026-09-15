from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("work_schedule", "0014_workitem_time_prefix_in_title")]
    operations = [migrations.AddField(
        model_name="workitem", name="priority_before_time",
        field=models.CharField(blank=True, null=True, max_length=20,
                               choices=[("low", "Thấp"), ("medium", "Vừa"), ("high", "Cao")]),
    )]
