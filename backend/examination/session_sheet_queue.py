"""Append new web registrations to the existing session roster tabs."""
import logging
import uuid
from collections import defaultdict

from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from .candidate_sheet_queue import launch_candidate_sheet_worker
from .models import Candidate, ExaminationSheet, SessionSheetOutbox
from .partner_contact_sync import _single_worker
from .sync import export_session_to_google_sheet, sheet_values_fingerprint


logger = logging.getLogger(__name__)
FORM_WORKBOOK_ID = '1gqO1Tp4YSBp0UVBgXjJgvL8CuqftVKGNd74PPRX9i8E'


def destinations(session_id):
    # All linked candidate templates participate. The separate public Form
    # workbook has its own marker/ack queue and a different row format.
    return ExaminationSheet.objects.filter(session_id=session_id).filter(
        Q(stage='session-output') | Q(stage='registration-source')
    ).exclude(url='').exclude(sheet_tab='').exclude(url__contains=FORM_WORKBOOK_ID)


def enqueue_session_candidate(candidate_id, session_id):
    if not destinations(session_id).exists():
        return
    SessionSheetOutbox.objects.update_or_create(
        candidate_id=str(candidate_id), session_id=str(session_id),
        defaults={'revision': uuid.uuid4(), 'attempts': 0, 'last_error': ''},
    )
    transaction.on_commit(launch_candidate_sheet_worker)


def drain_session_sheet_queue(limit=100):
    summary = {'synced': 0, 'failed': 0, 'appended': 0}
    with _single_worker():
        grouped = defaultdict(list)
        for job in SessionSheetOutbox.objects.order_by('attempts', 'enqueued_at')[:limit]:
            grouped[job.session_id].append(job)
        for session_id, jobs in grouped.items():
            try:
                codes = list(Candidate.objects.filter(pk__in=[job.candidate_id for job in jobs]).values_list('code', flat=True))
                for sheet in destinations(session_id):
                    result = export_session_to_google_sheet(sheet, export_mode='append-only', append_candidate_codes=codes, validate_template=True)
                    if result.get('exported'):
                        summary['appended'] += result['exported']
                        sheet.last_export_at = timezone.now()
                        fields = ['last_export_at', 'updated_at']
                        sheet.updated_at = timezone.now()
                        if sheet.stage == 'session-output' and result.get('currentFingerprint') == (sheet.last_content_fingerprint or sheet_values_fingerprint([])):
                            sheet.last_content_fingerprint = result['fingerprint']
                            fields.append('last_content_fingerprint')
                        sheet.save(update_fields=fields)
                        from .sheet_scheduler import record_sheet_log
                        record_sheet_log(sheet, f'Hàng đợi đã ghi thêm {result["exported"]} thí sinh từ web vào tab {sheet.sheet_tab}.')
                for job in jobs:
                    SessionSheetOutbox.objects.filter(pk=job.pk, revision=job.revision).delete()
                summary['synced'] += len(jobs)
            except Exception as exc:
                SessionSheetOutbox.objects.filter(pk__in=[job.pk for job in jobs]).update(
                    attempts=F('attempts') + 1, last_error=str(exc)[:1000],
                )
                logger.exception('Không ghi được thí sinh mới vào Sheet kỳ thi %s.', session_id)
                summary['failed'] += len(jobs)
    return summary
