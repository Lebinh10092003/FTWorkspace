from django.db import migrations, models


def make_numbering_continuous(apps, schema_editor):
    Record = apps.get_model("documents", "FundingProposalRecord")
    Counter = apps.get_model("documents", "FundingProposalNumberCounter")

    # Keep the numbers already issued in each year. Reserve all numbers up to
    # that year's counter, including numbers whose drafts were later deleted.
    yearly_highs = {
        counter.year: counter.last_number
        for counter in Counter.objects.all()
    }
    for year, sequence in Record.objects.exclude(
        number_year__isnull=True,
    ).exclude(sequence_number__isnull=True).values_list("number_year", "sequence_number"):
        yearly_highs[year] = max(yearly_highs.get(year, 0), sequence)

    offsets = {}
    reserved = 0
    for year in sorted(yearly_highs):
        offsets[year] = reserved
        reserved += yearly_highs[year]

    for record in Record.objects.exclude(sequence_number__isnull=True).order_by("number_year", "sequence_number", "pk"):
        sequence = offsets.get(record.number_year, reserved) + record.sequence_number
        record.sequence_number = sequence
        record.document_number = f"{sequence:02d}/PĐXKP-FT"
        record.save(update_fields=["sequence_number", "document_number"])

    # The folder already contains a manually numbered proposal 2. Treat it as
    # issued so the next new draft cannot produce another file named 2.
    last_number = max(2, reserved)
    Counter.objects.exclude(pk=1).delete()
    primary = Counter.objects.filter(pk=1).first()
    if primary:
        primary.last_number = last_number
        primary.save(update_fields=["last_number"])
    else:
        Counter.objects.create(pk=1, year=2026, last_number=last_number)


class Migration(migrations.Migration):
    dependencies = [("documents", "0003_funding_proposal_numbering")]

    operations = [
        migrations.RemoveConstraint(
            model_name="fundingproposalrecord",
            name="unique_funding_proposal_number_per_year",
        ),
        migrations.RunPython(make_numbering_continuous, migrations.RunPython.noop),
        migrations.RemoveField(model_name="fundingproposalrecord", name="number_year"),
        migrations.RemoveField(model_name="fundingproposalnumbercounter", name="year"),
        migrations.AddConstraint(
            model_name="fundingproposalrecord",
            constraint=models.UniqueConstraint(
                fields=("sequence_number",),
                name="unique_funding_proposal_number",
            ),
        ),
    ]
