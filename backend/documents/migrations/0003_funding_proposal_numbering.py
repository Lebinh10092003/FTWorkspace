from django.db import migrations, models


def normalize_existing_proposals(apps, schema_editor):
    Record = apps.get_model("documents", "FundingProposalRecord")
    Counter = apps.get_model("documents", "FundingProposalNumberCounter")
    totals = {}
    for record in Record.objects.order_by("created_at", "pk"):
        year = record.created_at.year
        totals[year] = totals.get(year, 0) + 1
        record.number_year = year
        record.sequence_number = totals[year]
        record.document_number = f"{totals[year]:02d}/PĐXKP-FT"
        record.save(update_fields=["number_year", "sequence_number", "document_number"])
    for year, last_number in totals.items():
        Counter.objects.create(year=year, last_number=last_number)


class Migration(migrations.Migration):
    dependencies = [("documents", "0002_fundingproposalrecord")]

    operations = [
        migrations.AddField(
            model_name="fundingproposalrecord", name="number_year",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="fundingproposalrecord", name="sequence_number",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="FundingProposalNumberCounter",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("year", models.PositiveSmallIntegerField(unique=True)),
                ("last_number", models.PositiveIntegerField(default=0)),
            ],
        ),
        migrations.RunPython(normalize_existing_proposals, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="fundingproposalrecord",
            constraint=models.UniqueConstraint(
                fields=("number_year", "sequence_number"),
                name="unique_funding_proposal_number_per_year",
            ),
        ),
    ]
