import uuid

from django.utils import timezone
from authentication.notifications import notify_workspace

from .models import ExaminationSheet, LogNote
from .sync import (
    export_session_to_google_sheet,
    remote_sheet_fingerprint,
    sheet_values_fingerprint,
    tab_content_fingerprint,
)


def sheet_is_in_automation_window(sheet, today=None):
    today = today or timezone.localdate()
    return (
        sheet.automation_enabled
        and (not sheet.automation_start_date or sheet.automation_start_date <= today)
        and (not sheet.automation_end_date or sheet.automation_end_date >= today)
    )


def record_sheet_log(sheet, content):
    LogNote.objects.create(
        key=f'session-{sheet.session_id}:sheet:{uuid.uuid4().hex}',
        entity_key=f'session-{sheet.session_id}',
        content=content,
        updated_by='Hệ thống FT Workspace',
        system=True,
    )


def output_sheet_has_unreviewed_changes(sheet, google_access_token=None):
    current = remote_sheet_fingerprint(sheet, google_access_token)
    empty = sheet_values_fingerprint([])
    if not sheet.last_content_fingerprint:
        return current != empty, current
    return current != sheet.last_content_fingerprint, current


FORM_WORKBOOK_ID = '1gqO1Tp4YSBp0UVBgXjJgvL8CuqftVKGNd74PPRX9i8E'


def watched_candidate_sheet(sheet):
    """Manual candidate tabs; the Form workbook has its own registration queue."""
    return (
        sheet.stage in {'registration-source', 'session-output'}
        and bool(sheet.session_id)
        and FORM_WORKBOOK_ID not in (sheet.url or '')
    )


def flag_sheet_change(sheet, now, fingerprint):
    if sheet.pending_manual_import:
        return False
    sheet.pending_manual_import = True
    sheet.change_detected_at = now
    sheet.status = 'attention'
    sheet.last_error = 'Tab Google Sheet đã thay đổi; cần xem trước và nhập dữ liệu vào web.'
    sheet.updated_at = now
    sheet.save(update_fields=['pending_manual_import', 'change_detected_at', 'status', 'last_error', 'updated_at'])
    record_sheet_log(sheet, f'Tab {sheet.sheet_tab or sheet.name} đã thay đổi; chờ xem trước và nhập dữ liệu vào web.')
    notify_workspace(event_key=f'examination:sheet-change:{sheet.id}:{fingerprint}',
        title=f'Sheet khảo thí thay đổi: {sheet.sheet_tab or sheet.name}', message=sheet.last_error,
        severity='warning', category='examination', action_url=f'/examination/sessions/{sheet.session_id}',
        target_modules=['examination'])
    return True


def scan_sheet_changes(now=None, sheets=None):
    """Detect edits for review; never import data on an edit hint or timer."""
    now = now or timezone.now()
    summary = {'operation': 'change-scan', 'checked': 0, 'changed': 0, 'failed': 0, 'baselined': 0, 'autoImported': 0, 'needsReview': 0}
    watched = sheets if sheets is not None else ExaminationSheet.objects.exclude(url='').exclude(stage='form-webhook').order_by('session_id', 'id')
    for sheet in watched:
        if not watched_candidate_sheet(sheet):
            continue
        summary['checked'] += 1
        try:
            current = tab_content_fingerprint(sheet)
            if current == sheet.last_observed_fingerprint:
                continue
            if sheet.pending_manual_import:
                summary['needsReview'] += 1
                continue
            # Web outbox writes are already accepted; do not flag their echo.
            # A pending manual edit is never acknowledged through this path.
            web_echo = (sheet.stage == 'session-output' and sheet.last_content_fingerprint
                        and remote_sheet_fingerprint(sheet) == sheet.last_content_fingerprint)
            if web_echo or (not sheet.last_observed_fingerprint and not sheet.last_content_fingerprint):
                sheet.last_observed_fingerprint = current
                sheet.updated_at = now
                sheet.save(update_fields=['last_observed_fingerprint', 'updated_at'])
                summary['baselined'] += 1
            elif flag_sheet_change(sheet, now, current):
                summary['changed'] += 1
                summary['needsReview'] += 1
        except Exception as exc:
            summary['failed'] += 1
            sheet.status = 'attention' if sheet.pending_manual_import else 'failed'
            sheet.last_error = str(exc)
            sheet.updated_at = now
            sheet.save(update_fields=['status', 'last_error', 'updated_at'])
            continue
    return summary


def run_registration_imports(now=None):
    # Retain the legacy command without bypassing the review workflow.
    return scan_sheet_changes(now=now, sheets=ExaminationSheet.objects.filter(stage='registration-source'))


def run_output_exports(now=None):
    now = now or timezone.now()
    local_now = timezone.localtime(now)
    rows = ExaminationSheet.objects.filter(stage='session-output').order_by('session_id', 'id')
    summary = {'operation': 'output-export', 'processed': 0, 'success': 0, 'failed': 0, 'blocked': 0, 'skipped': 0}
    for sheet in rows:
        if not sheet_is_in_automation_window(sheet, local_now.date()):
            summary['skipped'] += 1
            continue
        summary['processed'] += 1
        try:
            changed, current = output_sheet_has_unreviewed_changes(sheet)
            if sheet.pending_manual_import or changed:
                flag_sheet_change(sheet, now, current)
                summary['blocked'] += 1
                continue
            result = export_session_to_google_sheet(sheet)
            sheet.last_export_at = now
            sheet.last_content_fingerprint = result.get('fingerprint', '')
            sheet.pending_manual_import = False
            sheet.change_detected_at = None
            sheet.last_observed_fingerprint = ''
            sheet.status = 'success'
            sheet.last_error = ''
            sheet.updated_at = now
            sheet.save(update_fields=['last_export_at', 'last_content_fingerprint', 'last_observed_fingerprint', 'change_detected_at', 'pending_manual_import', 'status', 'last_error', 'updated_at'])
            summary['success'] += 1
            record_sheet_log(sheet, f'Tự động xuất {result.get("exported", 0)} hồ sơ sang Sheet tổng hợp.')
        except Exception as exc:
            sheet.status = 'failed'
            sheet.last_error = str(exc)
            sheet.updated_at = now
            sheet.save(update_fields=['status', 'last_error', 'updated_at'])
            summary['failed'] += 1
            record_sheet_log(sheet, f'Tự động xuất Sheet tổng hợp thất bại: {exc}')
    return summary
