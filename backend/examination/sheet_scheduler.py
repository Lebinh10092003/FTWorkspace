import uuid

from django.utils import timezone
from django.db import transaction
from authentication.notifications import notify_workspace

from .models import ExaminationSheet, LogNote
from .sync import (
    export_session_to_google_sheet,
    remote_sheet_fingerprint,
    output_sheet_export_preview,
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


def import_registration_sheet(sheet, now, observed_fingerprint=''):
    """Apply one verified source atomically; never remove web-only registrations."""
    timestamp = timezone.localtime(now).strftime('%d/%m/%Y %H:%M:%S')
    previous_pending = sheet.pending_manual_import
    previous_error = sheet.last_error
    with transaction.atomic():
        result = sync_single_sheet(sheet.url, timestamp, sheet.id, sheet.session_id,
                                   sheet_tab=sheet.sheet_tab, automatic=True)
        if not result.get('success'):
            transaction.set_rollback(True)
    needs_review = bool(result.get('needsReview'))
    sheet.status = 'success' if result.get('success') else ('attention' if needs_review else 'failed')
    sheet.last_error = '' if result.get('success') else str(result.get('message') or 'Không thể tự động nhập dữ liệu.')
    sheet.pending_manual_import = needs_review
    sheet.change_detected_at = (sheet.change_detected_at or now) if needs_review else None
    sheet.updated_at = now
    if result.get('success'):
        sheet.last_import_at = now
        sheet.last_observed_fingerprint = result.get('fingerprint') or observed_fingerprint
        if result.get('created') or result.get('updated') or previous_pending:
            record_sheet_log(sheet, f'Tự động nhập Sheet đầu vào: {result.get("created", 0)} hồ sơ mới, {result.get("updated", 0)} hồ sơ cập nhật.')
    elif not previous_pending or previous_error != sheet.last_error:
        record_sheet_log(sheet, f'Tự động nhập Sheet đầu vào: {sheet.last_error}')
        if needs_review:
            notify_workspace(event_key=f'examination:sheet-review:{sheet.id}:{result.get("fingerprint") or observed_fingerprint}',
                title=f'Sheet khảo thí cần kiểm tra: {sheet.sheet_tab or sheet.name}', message=sheet.last_error,
                severity='warning', category='examination', action_url='/examination/import', target_modules=['examination'])
    sheet.save(update_fields=['last_import_at', 'last_observed_fingerprint', 'pending_manual_import',
                             'change_detected_at', 'status', 'last_error', 'updated_at'])
    return result


def scan_sheet_changes(now=None, sheets=None):
    """Import enabled registration sources on change; flag other tabs for review."""
    now = now or timezone.now()
    summary = {'operation': 'change-scan', 'checked': 0, 'changed': 0, 'failed': 0, 'baselined': 0, 'autoImported': 0, 'needsReview': 0}
    watched = sheets if sheets is not None else ExaminationSheet.objects.exclude(url='').exclude(stage='form-webhook').order_by('session_id', 'id')
    for sheet in watched:
        # Bound Apps Script handles private form tabs. The generic scanner cannot
        # read them and would otherwise raise a false manual-import warning.
        if sheet.stage == 'form-webhook':
            continue
        summary['checked'] += 1
        try:
            current = tab_content_fingerprint(sheet)
        except Exception as exc:
            summary['failed'] += 1
            sheet.status = 'failed' if not sheet.pending_manual_import else 'attention'
            sheet.last_error = str(exc)
            sheet.updated_at = now
            sheet.save(update_fields=['status', 'last_error', 'updated_at'])
            continue
        if sheet.stage == 'registration-source' and sheet_is_in_automation_window(sheet, timezone.localtime(now).date()):
            if sheet.pending_manual_import or current != sheet.last_observed_fingerprint:
                result = import_registration_sheet(sheet, now, current)
                if result.get('success'):
                    summary['autoImported'] += 1
                elif result.get('needsReview'):
                    summary['needsReview'] += 1
                else:
                    summary['failed'] += 1
            continue
        if not sheet.last_observed_fingerprint or sheet.last_observed_fingerprint[:4] != current[:4]:
            sheet.last_observed_fingerprint = current
            sheet.updated_at = now
            sheet.save(update_fields=['last_observed_fingerprint', 'updated_at'])
            summary['baselined'] += 1
        elif current != sheet.last_observed_fingerprint and not sheet.pending_manual_import:
            sheet.pending_manual_import = True
            sheet.change_detected_at = now
            sheet.status = 'attention'
            sheet.last_error = 'Tab Google Sheet đã thay đổi; cần xem trước và nhập dữ liệu vào web.'
            sheet.updated_at = now
            sheet.save(update_fields=['pending_manual_import', 'change_detected_at', 'status', 'last_error', 'updated_at'])
            record_sheet_log(sheet, f'Tab {sheet.sheet_tab or "đầu tiên"} của {sheet.name} đã thay đổi; cần kiểm tra và nhập dữ liệu.')
            notify_workspace(
                event_key=f'examination:sheet-change:{sheet.id}:{current}',
                title=f'Sheet khảo thí thay đổi: {sheet.sheet_tab or sheet.name}',
                message=f'Tab {sheet.sheet_tab or "đầu tiên"} của {sheet.name} đã thay đổi. Hãy xem trước và nhập dữ liệu vào web.',
                severity='warning',
                category='examination',
                action_url='/examination/import',
                target_modules=['examination'],
            )
            summary['changed'] += 1
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
                sheet.pending_manual_import = True
                sheet.change_detected_at = sheet.change_detected_at or now
                sheet.status = 'attention'
                sheet.last_error = 'Sheet tổng hợp có chỉnh sửa chưa được nhập vào hệ thống.'
                sheet.updated_at = now
                sheet.save(update_fields=['pending_manual_import', 'change_detected_at', 'status', 'last_error', 'updated_at'])
                summary['blocked'] += 1
                record_sheet_log(sheet, 'Tạm dừng xuất tự động vì Sheet tổng hợp có chỉnh sửa đang chờ nhập thủ công.')
                continue
            preview = output_sheet_export_preview(sheet)
            if preview.get('appendedRows'):
                sheet.pending_manual_import = True
                sheet.change_detected_at = sheet.change_detected_at or now
                sheet.status = 'attention'
                sheet.last_error = 'Số lượng thí sinh giữa hệ thống và Sheet đang lệch; chờ người quản lý chọn cách xử lý.'
                sheet.updated_at = now
                sheet.save(update_fields=['pending_manual_import', 'change_detected_at', 'status', 'last_error', 'updated_at'])
                summary['blocked'] += 1
                record_sheet_log(sheet, 'Tạm dừng xuất tự động vì danh sách thí sinh giữa hệ thống và Sheet bị lệch.')
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
