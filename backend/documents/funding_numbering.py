"""A separate yearly number sequence for funding proposals."""
from django.db.models import F

from .models import FundingProposalNumberCounter
from .numbering import parse_date


def assign_funding_number(record, issued_on):
    """Call inside a transaction after locking the proposal record."""
    if record.sequence_number is not None:
        return record.document_number
    year = parse_date(issued_on).year
    counter, _ = FundingProposalNumberCounter.objects.get_or_create(year=year)
    FundingProposalNumberCounter.objects.filter(pk=counter.pk).update(last_number=F("last_number") + 1)
    counter.refresh_from_db()
    record.number_year = year
    record.sequence_number = counter.last_number
    record.document_number = f"{record.sequence_number:02d}/PĐXKP-FT"
    record.save(update_fields=["number_year", "sequence_number", "document_number", "updated_at"])
    return record.document_number
