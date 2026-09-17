from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("work_schedule", "0018_workitem_title_format_runs"),
    ]

    operations = [
        migrations.AddField(
            model_name="workitem",
            name="sheet_last_edited_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="workitem",
            name="sheet_last_editor_email",
            field=models.EmailField(blank=True, default="", max_length=254),
        ),
        migrations.AddField(
            model_name="workitem",
            name="sheet_last_event_id",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="workschedulesheetinboundevent",
            name="edited_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="workschedulesheetinboundevent",
            name="editor_email",
            field=models.EmailField(blank=True, default="", max_length=254),
        ),
    ]
