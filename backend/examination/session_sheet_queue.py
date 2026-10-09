"""Reconcile changed web registrations with their existing session roster rows."""
import logging
import uuid
from collections import defaultdict

from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from .candidate_sheet_queue import launch_candidate_sheet_worker
from .models import Candidate, CandidateParticipation, ExaminationSheet, SessionSheetOutbox
from .partner_contact_sync import _single_worker
from .sync import ensure_sheet_stt, export_session_to_google_sheet, remove_session_sheet_rows, sheet_values_fingerprint


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
    summary = {'synced': 0, 'failed': 0, 'appended': 0, 'updated': 0}
    with _single_worker():
        grouped = defaultdict(list)
        for job in SessionSheetOutbox.objects.order_by('attempts', 'enqueued_at')[:limit]:
            grouped[job.session_id].append(job)
        for session_id, jobs in grouped.items():
            try:
                code_by_id = dict(Candidate.objects.filter(pk__in=[job.candidate_id for job in jobs]).values_list('pk', 'code'))
                # Older sessions record membership only in Candidate.session_ids.
                members = set(CandidateParticipation.objects.filter(session_id=session_id, candidate_id__in=code_by_id).values_list('candidate_id', flat=True))
                members |= {pk for pk, ids in Candidate.objects.filter(pk__in=code_by_id).values_list('pk', 'session_ids') if session_id in (ids or [])}
                removed = [code for pk, code in code_by_id.items() if pk not in members]
                codes = [code for pk, code in code_by_id.items() if pk in members]
                failures, held = [], set()
                for sheet in destinations(session_id):
                    sheet_codes = codes
                    if sheet.stage == 'session-output':
                        try:
                            # STT is a formula on the Sheet; a failure here never blocks the queue.
                            ensure_sheet_stt(sheet)
                        except Exception as exc:
                            logger.warning('Không đặt được công thức STT cho %s: %s', sheet.pk, exc)
                        try:
                            # Hand edits on the Sheet (rooms, scores, ...) reach the web
                            # before the web writes its rows, so they are never overwritten.
                            from .sheet_scheduler import scan_sheet_changes
                            scan_sheet_changes(sheets=[sheet])
                            live = set(SessionSheetOutbox.objects.filter(pk__in=[job.pk for job in jobs]).values_list('candidate_id', flat=True))
                            sheet_codes = [code for pk, code in code_by_id.items() if pk in members and pk in live]
                        except Exception as exc:
                            logger.warning('Không đọc được thay đổi trên Sheet %s trước khi ghi: %s', sheet.pk, exc)
                    try:
                        deleted = remove_session_sheet_rows(sheet, removed)
                        if deleted:
                            from .sheet_scheduler import record_sheet_log
                            record_sheet_log(sheet, f'Đã xóa {deleted} dòng của thí sinh đã gỡ khỏi kỳ trong tab {sheet.sheet_tab}.')
                        result = export_session_to_google_sheet(sheet, export_mode='refresh-selected', append_candidate_codes=sheet_codes, validate_template=True)
                    except Exception as exc:
                        failures.append(f'{sheet.name}: {exc}')
                        ExaminationSheet.objects.filter(pk=sheet.pk).update(last_error=str(exc)[:1000])
                        continue
                    ExaminationSheet.objects.filter(pk=sheet.pk).update(last_error='')
                    held |= set(result.get('skippedCodes') or [])
                    if result.get('exported') or result.get('updated'):
                        summary['appended'] += result['exported']
                        summary['updated'] += result.get('updated', 0)
                        sheet.last_export_at = timezone.now()
                        fields = ['last_export_at', 'updated_at']
                        sheet.updated_at = timezone.now()
                        if sheet.stage == 'session-output' and result.get('currentFingerprint') == (sheet.last_content_fingerprint or sheet_values_fingerprint([])):
                            sheet.last_content_fingerprint = result['fingerprint']
                            fields.append('last_content_fingerprint')
                        sheet.save(update_fields=fields)
                        from .sheet_scheduler import record_sheet_log
                        record_sheet_log(sheet, f'Hàng đợi đã ghi thêm {result["exported"]} và cập nhật {result.get("updated", 0)} thí sinh từ web vào tab {sheet.sheet_tab}.')
                if failures:
                    raise ValueError('; '.join(failures))
                for job in jobs:
                    if str(code_by_id.get(job.candidate_id, '')).upper() in held:
                        # Only this candidate waits for a clearer Sheet row.
                        SessionSheetOutbox.objects.filter(pk=job.pk, revision=job.revision).update(
                            attempts=F('attempts') + 1, last_error='Dòng Sheet chưa ghép chắc chắn với hồ sơ này.')
                        summary['failed'] += 1
                        continue
                    SessionSheetOutbox.objects.filter(pk=job.pk, revision=job.revision).delete()
                    summary['synced'] += 1
            except Exception as exc:
                SessionSheetOutbox.objects.filter(pk__in=[job.pk for job in jobs]).update(
                    attempts=F('attempts') + 1, last_error=str(exc)[:1000],
                )
                logger.exception('Không ghi được thí sinh mới vào Sheet kỳ thi %s.', session_id)
                summary['failed'] += len(jobs)
    return summary
