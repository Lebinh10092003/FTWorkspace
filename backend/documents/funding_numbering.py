"""A single lifetime number sequence for funding proposals."""
from django.db.models import F

from .models import FundingProposalNumberCounter


def assign_funding_number(record):
    """Call inside a transaction after locking the proposal record."""
    if record.sequence_number is not None:
        return record.document_number
    counter = FundingProposalNumberCounter.objects.select_for_update().get(pk=1)
    FundingProposalNumberCounter.objects.filter(pk=counter.pk).update(last_number=F("last_number") + 1)
    counter.refresh_from_db()
    record.sequence_number = counter.last_number
    record.document_number = f"{record.sequence_number:02d}/PĐXKP-FT"
    record.save(update_fields=["sequence_number", "document_number", "updated_at"])
    return record.document_number
