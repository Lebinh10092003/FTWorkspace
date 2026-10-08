import uuid

from django.utils import timezone
from django.db import transaction

from .models import ExaminationSheet, LogNote, SessionSheetOutbox
from .sync import (
    export_session_to_google_sheet,
    session_export_rows,
    remote_sheet_fingerprint,
    sheet_values_fingerprint,
    sync_single_sheet,
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


def auto_import_supported(sheet):
    """Candidate tabs linked to a session; the Form workbook has its own Apps Script queue."""
    return (
        sheet.stage in {'registration-source', 'session-output'}
        and bool(sheet.session_id)
        and FORM_WORKBOOK_ID not in (sheet.url or '')
    )


def skipped_rows_summary(skipped, limit=20):
    lines = [f'Dòng {item["row"]} ({item["name"]}): {item["reason"]}' for item in skipped[:limit]]
    if len(skipped) > limit:
        lines.append(f'… và {len(skipped) - limit} dòng khác.')
    return '\n'.join(lines)


def import_registration_sheet(sheet, now, observed_fingerprint=''):
    """Apply Sheet edits to the web row by row; never remove web-only registrations.

    The Sheet is a mirror of the web that staff may edit by hand. Edits are
    applied automatically. A row that cannot be matched safely is skipped and
    written to the session log; it never blocks the remaining rows and never
    raises a "needs manual import" banner.
    """
    timestamp = timezone.localtime(now).strftime('%d/%m/%Y %H:%M:%S')
    with transaction.atomic():
        result = sync_single_sheet(sheet.url, timestamp, sheet.id, sheet.session_id,
                                   sheet_tab=sheet.sheet_tab, automatic=True)
        if not result.get('success'):
            transaction.set_rollback(True)
        elif result.get('updatedIds'):
            # The Sheet already holds these rows; writing them straight back
            # would erase any cell the importer could not represent.
            SessionSheetOutbox.objects.filter(session_id=str(sheet.session_id),
                                              candidate_id__in=result['updatedIds']).delete()
    previous_error = sheet.last_error
    skipped = result.get('skipped') or []
    sheet.pending_manual_import = False
    sheet.change_detected_at = None
    sheet.updated_at = now
    if result.get('success'):
        sheet.status = 'success'
        sheet.last_error = ''
        sheet.last_import_at = now
        sheet.last_observed_fingerprint = result.get('fingerprint') or observed_fingerprint
        if result.get('created') or result.get('updated') or skipped:
            content = (f'Tự động cập nhật từ tab {sheet.sheet_tab or sheet.name}: '
                       f'{result.get("created", 0)} hồ sơ mới, {result.get("updated", 0)} hồ sơ cập nhật.')
            if skipped:
                content += f'\nGiữ nguyên {len(skipped)} dòng chưa ghép chắc chắn với hồ sơ trên web:\n' + skipped_rows_summary(skipped)
            record_sheet_log(sheet, content)
    else:
        # Network/Google failures are retried by the next scan; keep the old
        # fingerprint so the edit is not lost.
        sheet.status = 'failed'
        sheet.last_error = str(result.get('message') or 'Không thể tự động nhập dữ liệu.')
        if previous_error != sheet.last_error:
            record_sheet_log(sheet, f'Tự động cập nhật từ tab {sheet.sheet_tab or sheet.name} chưa thành công: {sheet.last_error}')
    sheet.save(update_fields=['last_import_at', 'last_observed_fingerprint', 'pending_manual_import',
                             'change_detected_at', 'status', 'last_error', 'updated_at'])
    return result


def scan_sheet_changes(now=None, sheets=None):
    """Apply every changed candidate tab to the web; no manual-review flags."""
    now = now or timezone.now()
    summary = {'operation': 'change-scan', 'checked': 0, 'changed': 0, 'failed': 0, 'baselined': 0, 'autoImported': 0, 'needsReview': 0}
    watched = sheets if sheets is not None else ExaminationSheet.objects.exclude(url='').exclude(stage='form-webhook').order_by('session_id', 'id')
    for sheet in watched:
        if not auto_import_supported(sheet):
            continue
        summary['checked'] += 1
        try:
            current = tab_content_fingerprint(sheet)
        except Exception as exc:
            summary['failed'] += 1
            sheet.status = 'failed'
            sheet.last_error = str(exc)
            sheet.pending_manual_import = False
            sheet.updated_at = now
            sheet.save(update_fields=['status', 'last_error', 'pending_manual_import', 'updated_at'])
            continue
        if current == sheet.last_observed_fingerprint and not sheet.pending_manual_import:
            continue
        # The tab only changed because the web itself wrote it: accept it as
        # the new baseline instead of re-reading every row.
        try:
            web_echo = (sheet.stage == 'session-output' and sheet.last_content_fingerprint
                        and remote_sheet_fingerprint(sheet) == sheet.last_content_fingerprint)
        except Exception:
            web_echo = False
        if web_echo:
            sheet.last_observed_fingerprint = current
            sheet.pending_manual_import = False
            sheet.updated_at = now
            sheet.save(update_fields=['last_observed_fingerprint', 'pending_manual_import', 'updated_at'])
            summary['baselined'] += 1
            continue
        summary['changed'] += 1
        result = import_registration_sheet(sheet, now, current)
        if result.get('success'):
            summary['autoImported'] += 1
            summary['needsReview'] += len(result.get('skipped') or [])
        else:
            summary['failed'] += 1
    return summary


def run_registration_imports(now=None):
    now = now or timezone.now()
    local_now = timezone.localtime(now)
    rows = ExaminationSheet.objects.filter(stage='registration-source').order_by('session_id', 'id')
    summary = {'operation': 'registration-import', 'processed': 0, 'success': 0, 'failed': 0, 'skipped': 0, 'blocked': 0}
    for sheet in rows:
        if not sheet_is_in_automation_window(sheet, local_now.date()):
            summary['skipped'] += 1
            continue
        summary['processed'] += 1
        result = import_registration_sheet(sheet, now)
        if result.get('success'):
            summary['success'] += 1
        elif result.get('needsReview'):
            summary['blocked'] += 1
        else:
            summary['failed'] += 1
    return summary


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
            changed, _ = output_sheet_has_unreviewed_changes(sheet)
            if changed:
                # Bring manual Sheet edits into the web first; the export below
                # rewrites the tab from the web roster.
                imported = import_registration_sheet(sheet, now)
                if not imported.get('success') or imported.get('skipped'):
                    sheet.status = 'success' if imported.get('success') else 'failed'
                    sheet.updated_at = now
                    sheet.save(update_fields=['status', 'updated_at'])
                    summary['blocked'] += 1
                    record_sheet_log(sheet, 'Giữ nguyên tab Sheet tổng hợp (không ghi lại toàn bộ) vì còn dòng chưa ghép chắc chắn với hồ sơ trên web.')
                    continue
            # Update matching rows in place and append new ones; never clear
            # and rewrite the tab (that reorders rows and drops Sheet-only cells).
            codes = [row[1] for row in session_export_rows(sheet.session_id)[2:] if row[1]]
            result = export_session_to_google_sheet(sheet, export_mode='refresh-selected',
                                                    append_candidate_codes=codes, validate_template=True)
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
