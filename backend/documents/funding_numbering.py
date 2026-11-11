"""A single lifetime number sequence for funding proposals."""
from django.db.models import F

from .models import FundingProposalNumberCounter, FundingProposalRecord


def assign_funding_number(record, manual_number=None):
    """Call inside a transaction after locking the proposal record."""
    if record.sequence_number is not None:
        if manual_number is not None and manual_number != record.sequence_number:
            raise ValueError('Phiếu này đã được cấp số. Hãy tạo phiếu mới nếu cần số khác.')
        return record.document_number
    counter = FundingProposalNumberCounter.objects.select_for_update().get(pk=1)
    if manual_number is not None:
        if not isinstance(manual_number, int) or not 1 <= manual_number <= 999999999:
            raise ValueError('Số phiếu phải là số nguyên từ 1 đến 999999999.')
        if FundingProposalRecord.objects.filter(sequence_number=manual_number).exclude(pk=record.pk).exists():
            raise ValueError('Số phiếu đã được sử dụng. Vui lòng nhập số khác.')
        counter.last_number = max(counter.last_number, manual_number)
        counter.save(update_fields=['last_number'])
        record.sequence_number = manual_number
    else:
        FundingProposalNumberCounter.objects.filter(pk=counter.pk).update(last_number=F("last_number") + 1)
        counter.refresh_from_db()
        record.sequence_number = counter.last_number
    record.document_number = f"{record.sequence_number:02d}/PĐXKP-FT"
    record.save(update_fields=["sequence_number", "document_number", "updated_at"])
    return record.document_number
