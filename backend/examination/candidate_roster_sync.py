"""Mirror the web candidate list: exactly one row per profile code."""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime

from django.utils import timezone

from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service

from .models import Candidate
from .partner_contact_sync import SPREADSHEET_ID, _single_worker
from .sync import format_identity, format_phone, format_sheet_date


logger = logging.getLogger(__name__)
TAB_TITLE = 'Phụ huynh Thí sinh từng tham gi'
SYNC_CONFIG_KEY = 'examination_candidate_roster_sheet_sync'
LAYOUT_VERSION = 3
HEADERS = [
    'Mã hồ sơ', 'Họ và tên thí sinh', 'Trường học', 'Khối lớp',
    'Các cuộc thi đã tham gia', 'Cập nhật lần cuối',
    'Ngày sinh', 'Họ tên phụ huynh', 'Số điện thoại', 'CCCD / Hộ chiếu',
    'Email', 'Quốc tịch', 'Lớp', 'Tỉnh / Thành phố', 'Phường / Xã', 'Địa chỉ',
]


def _display_time(value):
    if not isinstance(value, datetime):
        return ''
    return timezone.localtime(value).strftime('%d/%m/%Y %H:%M')


def candidate_code_sort_key(code):
    """Match the web list: numeric FT codes first, then natural code order."""
    text = str(code or '').strip().casefold()
    match = re.fullmatch(r'ft-(\d+)', text)
    numeric = int(match.group(1)) if match else 9007199254740991
    natural = tuple((0, int(part)) if part.isdigit() else (1, part) for part in re.split(r'(\d+)', text))
    return numeric, natural


def candidate_rows(candidate_ids=None):
    """Export the candidate profile fields displayed on the web, once per code."""
    records = []
    seen_codes = set()
    candidates = Candidate.objects.all()
    if candidate_ids is not None:
        candidates = candidates.filter(pk__in=candidate_ids)
    for candidate in candidates.iterator(chunk_size=500):
        code = str(candidate.code or '').strip()
        if not code or code.casefold() in seen_codes:
            raise ValueError('Mã hồ sơ trên web bị trống hoặc trùng; dừng xuất để bảo toàn dữ liệu.')
        seen_codes.add(code.casefold())
        records.append([
            code, candidate.name, candidate.school or '', candidate.grade or '',
            candidate.contests or '', candidate.updated or _display_time(candidate.updated_at),
            format_sheet_date(candidate.birth_date), candidate.parent or '', format_phone(candidate.phone),
            format_identity(candidate.identity), candidate.email or '', candidate.nationality or '',
            candidate.class_name or '', candidate.city or '', candidate.ward or '', candidate.address or '',
        ])
    records.sort(key=lambda row: candidate_code_sort_key(row[0]))
    return [HEADERS, *records]


def _sheet_values_equal(remote, expected):
    if len(remote) != len(expected):
        return False
    for current, proposed in zip(remote, expected):
        if list(current) != list(proposed)[:len(current)]:
            return False
        if any(value not in ('', None) for value in proposed[len(current):]):
            return False
    return True


def audit_candidate_roster():
    """Read-only comparison; return counts without participant contact data."""
    expected = candidate_rows()
    main = SystemConfig.objects.filter(key='main').first()
    service = build_sheets_service('', (main.data if main else {}) or {})
    spreadsheet_id = os.getenv('EXAMINATION_PARTNER_CONTACT_SHEET_ID', SPREADSHEET_ID).strip()
    tab = "'" + TAB_TITLE.replace("'", "''") + "'"
    current = service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=f'{tab}!A:P').execute().get('values', [])
    codes = [str(row[0]).strip() for row in current[1:] if row and row[0]]
    return {'webCandidates': len(expected) - 1, 'sheetRows': len(current) - 1,
            'uniqueProfileCodes': len({code.casefold() for code in codes}),
            'duplicateRows': len(codes) - len({code.casefold() for code in codes}),
            'sortedByProfileCode': codes == sorted(codes, key=candidate_code_sort_key),
            'matchesWeb': _sheet_values_equal(current, expected)}


def sync_candidate_roster(*, force=False):
    """Replace the managed roster tab when it differs from the web database."""
    with _single_worker():
        rows = candidate_rows()
        config, _ = SystemConfig.objects.get_or_create(key=SYNC_CONFIG_KEY)
        try:
            main = SystemConfig.objects.filter(key='main').first()
            service = build_sheets_service('', (main.data if main else {}) or {})
            spreadsheet_id = os.getenv('EXAMINATION_PARTNER_CONTACT_SHEET_ID', SPREADSHEET_ID).strip()
            sheets = service.spreadsheets()
            metadata = sheets.get(
                spreadsheetId=spreadsheet_id,
                fields='sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount)))',
            ).execute()
            target = next((sheet['properties'] for sheet in metadata.get('sheets', [])
                           if sheet.get('properties', {}).get('title') == TAB_TITLE), None)
            if target is None or target.get('hidden'):
                raise ValueError(f'Không tìm thấy tab đang hiển thị: {TAB_TITLE}')
            grid = target.get('gridProperties', {})
            if grid.get('rowCount', 1000) < len(rows) or grid.get('columnCount', 26) < 26:
                sheets.batchUpdate(spreadsheetId=spreadsheet_id, body={'requests': [
                    {'updateSheetProperties': {'properties': {'sheetId': target['sheetId'], 'gridProperties': {
                        'rowCount': max(grid.get('rowCount', 1000), len(rows)),
                        'columnCount': max(grid.get('columnCount', 26), 26),
                    }}, 'fields': 'gridProperties.rowCount,gridProperties.columnCount'}},
                ]}).execute()
            tab = "'" + TAB_TITLE.replace("'", "''") + "'"
            current = sheets.values().get(spreadsheetId=spreadsheet_id, range=f'{tab}!A:P').execute().get('values', [])
            if not force and _sheet_values_equal(current, rows) and (config.data or {}).get('layoutVersion') == LAYOUT_VERSION:
                result = {'status': 'unchanged', 'candidates': len({row[0] for row in rows[1:]}), 'rows': len(rows) - 1}
            else:
                # Remove old per-session columns once; preserve mail-merge
                # extension columns after the profile layout is established.
                legacy_layout = 'Mã kỳ tổ chức' in (current[0] if current else [])
                clear_end = 'Z' if legacy_layout else 'P'
                sheets.values().clear(spreadsheetId=spreadsheet_id, range=f'{tab}!A:{clear_end}', body={}).execute()
                for start in range(0, len(rows), 300):
                    sheets.values().update(
                        spreadsheetId=spreadsheet_id, range=f'{tab}!A{start + 1}',
                        valueInputOption='RAW', body={'values': rows[start:start + 300]},
                    ).execute()
                requests = [
                    {'updateDimensionProperties': {'range': {'sheetId': target['sheetId'], 'dimension': 'COLUMNS', 'startIndex': 0, 'endIndex': len(HEADERS)}, 'properties': {'hiddenByUser': False, 'pixelSize': 140}, 'fields': 'hiddenByUser,pixelSize'}},
                    {'updateSheetProperties': {'properties': {'sheetId': target['sheetId'], 'gridProperties': {'frozenRowCount': 1, 'frozenColumnCount': 2}}, 'fields': 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'}},
                    {'updateDimensionProperties': {'range': {'sheetId': target['sheetId'], 'dimension': 'ROWS', 'startIndex': 0, 'endIndex': len(rows)}, 'properties': {'pixelSize': 28}, 'fields': 'pixelSize'}},
                    {'repeatCell': {'range': {'sheetId': target['sheetId'], 'startRowIndex': 0, 'endRowIndex': len(rows), 'startColumnIndex': 0, 'endColumnIndex': len(HEADERS)}, 'cell': {'userEnteredFormat': {'textFormat': {'fontFamily': 'Arial', 'fontSize': 10, 'bold': False}, 'backgroundColor': {'red': 1, 'green': 1, 'blue': 1}, 'verticalAlignment': 'MIDDLE', 'wrapStrategy': 'CLIP'}}, 'fields': 'userEnteredFormat'}},
                    {'repeatCell': {'range': {'sheetId': target['sheetId'], 'startRowIndex': 0, 'endRowIndex': 1, 'startColumnIndex': 0, 'endColumnIndex': len(HEADERS)}, 'cell': {'userEnteredFormat': {'textFormat': {'fontFamily': 'Arial', 'fontSize': 10, 'bold': True}, 'backgroundColor': {'red': 0.89, 'green': 0.94, 'blue': 1.0}, 'verticalAlignment': 'MIDDLE', 'wrapStrategy': 'WRAP'}}, 'fields': 'userEnteredFormat'}},
                    {'updateDimensionProperties': {'range': {'sheetId': target['sheetId'], 'dimension': 'ROWS', 'startIndex': 0, 'endIndex': 1}, 'properties': {'pixelSize': 38}, 'fields': 'pixelSize'}},
                    {'setBasicFilter': {'filter': {'range': {'sheetId': target['sheetId'], 'startRowIndex': 0, 'startColumnIndex': 0, 'endColumnIndex': len(HEADERS)}}}},
                ]
                if legacy_layout:
                    requests.append({'repeatCell': {'range': {'sheetId': target['sheetId'], 'startColumnIndex': len(HEADERS), 'endColumnIndex': 26}, 'cell': {}, 'fields': 'userEnteredFormat'}})
                for index, width in {1: 185, 2: 230, 4: 230, 5: 170, 7: 185, 10: 220, 15: 320}.items():
                    requests.append({'updateDimensionProperties': {'range': {'sheetId': target['sheetId'], 'dimension': 'COLUMNS', 'startIndex': index, 'endIndex': index + 1}, 'properties': {'pixelSize': width}, 'fields': 'pixelSize'}})
                sheets.batchUpdate(spreadsheetId=spreadsheet_id, body={'requests': requests}).execute()
                verified = sheets.values().get(spreadsheetId=spreadsheet_id, range=f'{tab}!A:P').execute().get('values', [])
                if not _sheet_values_equal(verified, rows):
                    raise ValueError('Sheet chưa khớp danh sách chuẩn sau khi ghi; cần thử lại.')
                result = {'status': 'synced', 'candidates': len({row[0] for row in rows[1:]}), 'rows': len(rows) - 1}
        except Exception as exc:
            config.data = {'error': str(exc), 'failedAt': timezone.now().isoformat()}
            config.save(update_fields=['data'])
            logger.exception('Không đồng bộ được danh sách thí sinh vào Google Sheet.')
            raise
        config.data = {**result, 'layoutVersion': LAYOUT_VERSION, 'syncedAt': timezone.now().isoformat()}
        config.save(update_fields=['data'])
        return result
