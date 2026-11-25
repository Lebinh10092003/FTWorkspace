"""Retryable export of Workspace registrations to the original Form workbook."""

import re
from django.utils import timezone

from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service
from .form_registration import SPREADSHEET_ID, TAB_CODES, form_layout
from .models import PublicExamRegistration
from .sync import format_identity, format_phone


MARKER_HEADER = 'Mã đăng ký Workspace'
MARKER_INDEX = 17
# Hồ sơ (họ tên…lớp) và họ tên phụ huynh: các ô web được cập nhật lại.
PROFILE_INDEXES = tuple(range(2, 12))
PARENT_INDEX = 16


def quoted(tab):
    return "'" + tab.replace("'", "''") + "'"


def column_letter(index):
    """0 -> A, 25 -> Z, 26 -> AA."""
    letters = ''
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def tab_layout(headers):
    """{vị trí chuẩn: cột thật} của tab; tab chưa có tiêu đề Form thì theo vị trí chuẩn."""
    layout = form_layout(headers)
    if 2 not in layout:
        current = str(headers[MARKER_INDEX] or '').strip() if len(headers) > MARKER_INDEX else ''
        if current not in ('', MARKER_HEADER):
            raise ValueError('Cột R của tab đang được dùng cho dữ liệu khác.')
        return {index: index for index in range(MARKER_INDEX + 1)}, current == MARKER_HEADER
    if MARKER_INDEX not in layout:
        free_r = len(headers) <= MARKER_INDEX or not str(headers[MARKER_INDEX] or '').strip()
        layout[MARKER_INDEX] = MARKER_INDEX if free_r and MARKER_INDEX not in layout.values() else len(headers)
        return layout, False
    return layout, True


def column_ranges(tab, row_number, cells):
    """[(cột, giá trị)] -> các dải liền nhau để ghi một lần."""
    ranges = []
    for column, value in sorted(cells):
        if ranges and ranges[-1][1] == column - 1:
            ranges[-1][1] = column
            ranges[-1][2].append(value)
        else:
            ranges.append([column, column, [value]])
    return [{'range': f'{quoted(tab)}!{column_letter(first)}{row_number}' + (f':{column_letter(last)}{row_number}' if last != first else ''),
             'values': [values]} for first, last, values in ranges]


def row_for(item, tab):
    candidate = item.candidate
    chosen = [code for code in item.contest_codes if code in TAB_CODES[tab]]
    values = [''] * 18
    values[:12] = [
        timezone.localtime(item.created_at).strftime('%d/%m/%Y %H:%M:%S'), candidate.email or '',
        candidate.name, candidate.birth_date or '', format_identity(candidate.identity),
        candidate.email or '', candidate.city or '', candidate.ward or '',
        candidate.address or '', format_phone(candidate.phone), candidate.school or '',
        candidate.class_name or candidate.grade or '',
    ]
    if tab == 'SIAIO':
        # SIAIO không có câu chọn cuộc thi; ảnh thanh toán là cột "thanh toán"
        # đầu tiên, vị trí chuẩn 13 (xem FORM_COLUMNS).
        values[13] = f'Chứng từ trên Workspace #{item.id}' if item.proof_type else ''
    else:
        values[12] = ', '.join(chosen)
        values[13] = ('Có' if item.payment_declared else 'Chưa xác nhận') if tab == 'FIMO, FIEO' else (f'Chứng từ trên Workspace #{item.id}' if item.proof_type else '')
    values[17] = f'WORKSPACE:{item.id}'
    values[16] = candidate.parent or ''
    return values


def sync_registration(item, service=None):
    if service is None:
        config = SystemConfig.objects.filter(key='main').first()
        service = build_sheets_service(
            config.last_google_access_token if config else None,
            (config.data if config else {}) or {},
        )
    sheets = service.spreadsheets()
    metadata = sheets.get(spreadsheetId=SPREADSHEET_ID, fields='sheets(properties(sheetId,title,gridProperties(columnCount)))').execute()
    properties = {sheet['properties']['title']: sheet['properties'] for sheet in metadata.get('sheets', [])}
    tabs = [tab for tab, allowed in TAB_CODES.items() if any(code in allowed for code in item.contest_codes)]
    marker = f'WORKSPACE:{item.id}'
    recorded = dict(item.sheet_rows or {})
    for tab in tabs:
        if tab not in properties:
            raise ValueError(f'Thiếu tab {tab} trong Sheet đăng ký.')
        sheet = properties[tab]
        # Staff may insert columns such as "Hóa đơn" mid-tab: find every field by
        # its header instead of a fixed letter.
        header_rows = sheets.values().get(spreadsheetId=SPREADSHEET_ID, range=f'{quoted(tab)}!1:1').execute().get('values', [])
        headers = header_rows[0] if header_rows else []
        layout, has_marker_header = tab_layout(headers)
        marker_column = layout[MARKER_INDEX]
        width = max(layout.values()) + 1
        if sheet.get('gridProperties', {}).get('columnCount', 0) < width:
            sheets.batchUpdate(spreadsheetId=SPREADSHEET_ID, body={'requests': [{
                'updateSheetProperties': {
                    'properties': {'sheetId': sheet['sheetId'], 'gridProperties': {'columnCount': width}},
                    'fields': 'gridProperties.columnCount',
                },
            }]}).execute()
        marker_letter = column_letter(marker_column)
        if not has_marker_header:
            sheets.values().update(
                spreadsheetId=SPREADSHEET_ID, range=f'{quoted(tab)}!{marker_letter}1', valueInputOption='RAW',
                body={'values': [[MARKER_HEADER]]},
            ).execute()
        marker_rows = sheets.values().get(
            spreadsheetId=SPREADSHEET_ID, range=f'{quoted(tab)}!{marker_letter}2:{marker_letter}',
        ).execute().get('values', [])
        found = next((index + 2 for index, cells in enumerate(marker_rows) if cells and cells[0] == marker), None)
        values = row_for(item, tab)
        if found is None:
            row = [''] * width
            for index, column in layout.items():
                row[column] = values[index]
            result = sheets.values().append(
                spreadsheetId=SPREADSHEET_ID, range=f'{quoted(tab)}!A:{column_letter(width - 1)}',
                valueInputOption='RAW', insertDataOption='INSERT_ROWS',
                body={'values': [row]},
            ).execute()
            updated_range = result.get('updates', {}).get('updatedRange', '')
            match = re.search(r'![A-Z]+(\d+):', updated_range)
            found = int(match.group(1)) if match else 0
        else:
            # Refresh the profile only: original submission time, response email,
            # contest choices, payment evidence and accounting remain untouched.
            cells = [(layout[index], values[index]) for index in PROFILE_INDEXES if index in layout]
            if item.candidate.parent and PARENT_INDEX in layout:
                cells.append((layout[PARENT_INDEX], item.candidate.parent))
            sheets.values().batchUpdate(spreadsheetId=SPREADSHEET_ID,
                body={'valueInputOption': 'RAW', 'data': column_ranges(tab, found, cells)}).execute()
        recorded[tab] = found
        item.sheet_rows = recorded
        item.save(update_fields=['sheet_rows', 'updated_at'])
    item.sheet_status = 'synced'
    item.sheet_error = ''
    item.save(update_fields=['sheet_status', 'sheet_error', 'updated_at'])
    return recorded


def sync_pending(limit=30, refresh_only=False):
    result = {'synced': 0, 'failed': 0}
    items = PublicExamRegistration.objects.select_related('candidate').defer('proof').exclude(sheet_status='synced')
    if refresh_only:
        items = items.filter(sheet_status='refresh')
    for item in items.order_by('created_at')[:limit]:
        refreshing = item.sheet_status == 'refresh'
        try:
            sync_registration(item)
            result['synced'] += 1
        except Exception as exc:
            item.sheet_status = 'refresh' if refreshing else 'error'
            item.sheet_error = str(exc)[:1000]
            item.save(update_fields=['sheet_status', 'sheet_error', 'updated_at'])
            result['failed'] += 1
    return result
