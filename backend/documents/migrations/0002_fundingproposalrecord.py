from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("documents", "0001_initial")]

    operations = [
        migrations.CreateModel(
            name="FundingProposalRecord",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("draft_id", models.UUIDField(unique=True)),
                ("owner_email", models.EmailField(max_length=254)),
                ("document_number", models.CharField(blank=True, default="", max_length=64)),
                ("drive_file_id", models.CharField(blank=True, default="", max_length=180)),
                ("drive_url", models.URLField(blank=True, default="", max_length=500)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
        ),
    ]
