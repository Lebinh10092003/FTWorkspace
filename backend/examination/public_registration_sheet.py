"""Retryable export of Workspace registrations to the original Form workbook."""

import re

from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service
from .form_registration import SPREADSHEET_ID, TAB_CODES
from .models import PublicExamRegistration


MARKER_HEADER = 'Mã đăng ký Workspace'


def quoted(tab):
    return "'" + tab.replace("'", "''") + "'"


def row_for(item, tab):
    candidate = item.candidate
    chosen = [code for code in item.contest_codes if code in TAB_CODES[tab]]
    values = [''] * 18
    values[:12] = [
        item.created_at.strftime('%d/%m/%Y %H:%M:%S'), candidate.email or '',
        candidate.name, candidate.birth_date or '', candidate.identity or '',
        candidate.email or '', candidate.city or '', candidate.ward or '',
        candidate.address or '', candidate.phone or '', candidate.school or '',
        candidate.grade or '',
    ]
    if tab == 'SIAIO':
        values[12] = f'Chứng từ trên Workspace #{item.id}' if item.proof_type else ''
    else:
        values[12] = ', '.join(chosen)
        values[13] = ('Có' if item.payment_declared else 'Chưa xác nhận') if tab == 'FIMO, FIEO' else (f'Chứng từ trên Workspace #{item.id}' if item.proof_type else '')
    values[17] = f'WORKSPACE:{item.id}'
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
        if sheet.get('gridProperties', {}).get('columnCount', 0) < 18:
            sheets.batchUpdate(spreadsheetId=SPREADSHEET_ID, body={'requests': [{
                'updateSheetProperties': {
                    'properties': {'sheetId': sheet['sheetId'], 'gridProperties': {'columnCount': 18}},
                    'fields': 'gridProperties.columnCount',
                },
            }]}).execute()
        header = sheets.values().get(spreadsheetId=SPREADSHEET_ID, range=f'{quoted(tab)}!R1').execute().get('values', [])
        if header and header[0] and header[0][0] not in ('', MARKER_HEADER):
            raise ValueError(f'Cột R của tab {tab} đang được dùng cho dữ liệu khác.')
        if not header or not header[0] or not header[0][0]:
            sheets.values().update(
                spreadsheetId=SPREADSHEET_ID, range=f'{quoted(tab)}!R1', valueInputOption='RAW',
                body={'values': [[MARKER_HEADER]]},
            ).execute()
        marker_rows = sheets.values().get(
            spreadsheetId=SPREADSHEET_ID, range=f'{quoted(tab)}!R2:R',
        ).execute().get('values', [])
        found = next((index + 2 for index, cells in enumerate(marker_rows) if cells and cells[0] == marker), None)
        if found is None:
            result = sheets.values().append(
                spreadsheetId=SPREADSHEET_ID, range=f'{quoted(tab)}!A:R',
                valueInputOption='RAW', insertDataOption='INSERT_ROWS',
                body={'values': [row_for(item, tab)]},
            ).execute()
            updated_range = result.get('updates', {}).get('updatedRange', '')
            match = re.search(r'![A-Z]+(\d+):', updated_range)
            found = int(match.group(1)) if match else 0
        recorded[tab] = found
        item.sheet_rows = recorded
        item.save(update_fields=['sheet_rows', 'updated_at'])
    item.sheet_status = 'synced'
    item.sheet_error = ''
    item.save(update_fields=['sheet_status', 'sheet_error', 'updated_at'])
    return recorded


def sync_pending(limit=30):
    result = {'synced': 0, 'failed': 0}
    for item in PublicExamRegistration.objects.select_related('candidate').defer('proof').exclude(sheet_status='synced').order_by('created_at')[:limit]:
        try:
            sync_registration(item)
            result['synced'] += 1
        except Exception as exc:
            item.sheet_status = 'error'
            item.sheet_error = str(exc)[:1000]
            item.save(update_fields=['sheet_status', 'sheet_error', 'updated_at'])
            result['failed'] += 1
    return result
