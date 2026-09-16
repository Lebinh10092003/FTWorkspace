import re
from django.db import migrations


def normalize_personal_tasks(apps, schema_editor):
    WorkItem = apps.get_model("work_schedule", "WorkItem")
    personal = re.compile(r"(?<!\w)lịch\s+(?:cá\s+nhân|riêng)(?!\w)", re.IGNORECASE)
    for item in WorkItem.objects.using(schema_editor.connection.alias).only("id", "title", "time_prefix_in_title").iterator():
        if personal.search(item.title):
            WorkItem.objects.using(schema_editor.connection.alias).filter(pk=item.pk).update(priority="medium", priority_before_time="medium" if item.time_prefix_in_title else None)


class Migration(migrations.Migration):
    dependencies = [("work_schedule", "0015_workitem_priority_before_time")]
    operations = [migrations.RunPython(normalize_personal_tasks, migrations.RunPython.noop)]
