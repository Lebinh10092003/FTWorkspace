import uuid

from django.utils import timezone

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


def scan_sheet_changes(now=None):
    """Flag an edited competition tab for manual review without importing data."""
    now = now or timezone.now()
    summary = {'operation': 'change-scan', 'checked': 0, 'changed': 0, 'failed': 0, 'baselined': 0}
    for sheet in ExaminationSheet.objects.exclude(url='').order_by('session_id', 'id'):
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
            summary['changed'] += 1
    return summary


def run_registration_imports(now=None):
    now = now or timezone.now()
    local_now = timezone.localtime(now)
    rows = ExaminationSheet.objects.filter(stage='registration-source').order_by('session_id', 'id')
    summary = {'operation': 'registration-import', 'processed': 0, 'success': 0, 'failed': 0, 'skipped': 0}
    for sheet in rows:
        if not sheet_is_in_automation_window(sheet, local_now.date()):
            summary['skipped'] += 1
            continue
        summary['processed'] += 1
        timestamp = local_now.strftime('%d/%m/%Y %H:%M:%S')
        result = sync_single_sheet(sheet.url, timestamp, sheet.id, sheet.session_id, sheet_tab=sheet.sheet_tab)
        sheet.last_import_at = now
        sheet.status = 'success' if result.get('success') else 'failed'
        sheet.last_error = '' if result.get('success') else str(result.get('message') or 'Không thể nhập dữ liệu.')
        sheet.updated_at = now
        sheet.save(update_fields=['last_import_at', 'status', 'last_error', 'updated_at'])
        if result.get('success'):
            sheet.pending_manual_import = False
            sheet.change_detected_at = None
            sheet.last_observed_fingerprint = ''
            sheet.save(update_fields=['pending_manual_import', 'change_detected_at', 'last_observed_fingerprint'])
            summary['success'] += 1
            record_sheet_log(sheet, f'Tự động nhập Sheet đầu vào: {result.get("created", 0)} hồ sơ mới, {result.get("updated", 0)} hồ sơ cập nhật.')
        else:
            summary['failed'] += 1
            record_sheet_log(sheet, f'Tự động nhập Sheet đầu vào thất bại: {sheet.last_error}')
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
