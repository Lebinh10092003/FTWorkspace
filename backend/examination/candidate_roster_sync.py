"""Mirror every Examination registration into the shared Google Sheet."""
from __future__ import annotations

import logging
import os
from datetime import datetime

from django.utils import timezone

from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service

from .models import Candidate, Competition, ExamSession
from .partner_contact_sync import SPREADSHEET_ID, _single_worker
from .sync import format_sheet_date


logger = logging.getLogger(__name__)
TAB_TITLE = 'Phụ huynh Thí sinh từng tham gi'
SYNC_CONFIG_KEY = 'examination_candidate_roster_sheet_sync'
LAYOUT_VERSION = 2
HEADERS = [
    'Mã hồ sơ', 'Họ và tên thí sinh', 'Ngày sinh', 'Trường', 'Lớp', 'Khối',
    'Tỉnh / Thành phố', 'Phường / Xã', 'Họ tên phụ huynh', 'Số điện thoại', 'Email',
    'Mã cuộc thi', 'Cuộc thi', 'Mã kỳ tổ chức', 'Kỳ tổ chức', 'Thời gian',
    'Môn thi / Lĩnh vực', 'Bảng thi', 'Hình thức đăng ký', 'Ngày đăng ký',
    'Các vòng thi', 'Trạng thái dự thi', 'Kết quả / Giải thưởng', 'Cập nhật lần cuối',
]


def _display_time(value):
    if not isinstance(value, datetime):
        return ''
    return timezone.localtime(value).strftime('%d/%m/%Y %H:%M')


def _round_summary(participation):
    if not participation:
        return '', '', '', None
    rounds = list(participation.round_results.all())
    rounds.sort(key=lambda item: (item.created_at, str(item.id)))
    names = list(dict.fromkeys(item.round_name for item in rounds if item.round_name))
    attendance = [f'{item.round_name}: {item.attendance}' for item in rounds if item.attendance]
    results = [f'{item.round_name}: {item.result}' for item in rounds if item.result]
    latest = max((item.updated_at for item in rounds), default=None)
    return '; '.join(names), '; '.join(attendance), '; '.join(results), latest


def candidate_rows(candidate_ids=None):
    """One row per candidate and session, including explicit legacy memberships."""
    sessions = {item.id: item for item in ExamSession.objects.all()}
    competitions = {item.id: item for item in Competition.objects.all()}
    records = []
    candidates = Candidate.objects.all()
    if candidate_ids is not None:
        candidates = candidates.filter(pk__in=candidate_ids)
    candidates = candidates.prefetch_related('participations__round_results').iterator(chunk_size=500)
    for candidate in candidates:
        participations = {item.session_id: item for item in candidate.participations.all()}
        session_ids = set(participations) | {str(item) for item in candidate.session_ids or []}
        session_ids = {session_id for session_id in session_ids if session_id in sessions}
        for session_id in session_ids or {''}:
            session = sessions.get(session_id)
            if session_id and session is None:
                continue
            participation = participations.get(session_id)
            competition = competitions.get(session.competition_id) if session else None
            round_names, attendance, results, round_updated = _round_summary(participation)
            updated = max(value for value in (candidate.updated_at, participation.updated_at if participation else None, round_updated) if value)
            records.append((session.sort_key if session else '', candidate.sort_key, candidate.code, session_id, [
                candidate.code, candidate.name, format_sheet_date(candidate.birth_date),
                candidate.school or '', candidate.class_name or '', candidate.grade or '',
                candidate.city or '', candidate.ward or '', candidate.parent or '',
                candidate.phone or '', candidate.email or '',
                competition.code if competition else session.code if session else '',
                competition.name if competition else session.parent if session else '',
                session.code if session else '', session.name if session else '', session.time if session else '',
                participation.subject if participation else '',
                participation.category if participation else '',
                participation.registration_method if participation else '',
                _display_time(participation.created_at) if participation else '',
                round_names, attendance, results, _display_time(updated),
            ]))
    records.sort(key=lambda item: item[:4])
    return [HEADERS, *(item[4] for item in records)]


def _sheet_values_equal(remote, expected):
    if len(remote) != len(expected):
        return False
    for current, proposed in zip(remote, expected):
        if list(current) != list(proposed)[:len(current)]:
            return False
        if any(value not in ('', None) for value in proposed[len(current):]):
            return False
    return True


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
            if grid.get('rowCount', 1000) < len(rows) or grid.get('columnCount', 26) < len(HEADERS):
                sheets.batchUpdate(spreadsheetId=spreadsheet_id, body={'requests': [
                    {'updateSheetProperties': {'properties': {'sheetId': target['sheetId'], 'gridProperties': {
                        'rowCount': max(grid.get('rowCount', 1000), len(rows)),
                        'columnCount': max(grid.get('columnCount', 26), len(HEADERS)),
                    }}, 'fields': 'gridProperties.rowCount,gridProperties.columnCount'}},
                ]}).execute()
            tab = "'" + TAB_TITLE.replace("'", "''") + "'"
            current = sheets.values().get(spreadsheetId=spreadsheet_id, range=f'{tab}!A:X').execute().get('values', [])
            if not force and _sheet_values_equal(current, rows) and (config.data or {}).get('layoutVersion') == LAYOUT_VERSION:
                result = {'status': 'unchanged', 'candidates': len({row[0] for row in rows[1:]}), 'registrations': len(rows) - 1}
            else:
                sheets.values().clear(spreadsheetId=spreadsheet_id, range=f'{tab}!A:X', body={}).execute()
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
                for index, width in {1: 185, 3: 210, 8: 185, 10: 220, 12: 190, 14: 190, 20: 190, 21: 230, 22: 230}.items():
                    requests.append({'updateDimensionProperties': {'range': {'sheetId': target['sheetId'], 'dimension': 'COLUMNS', 'startIndex': index, 'endIndex': index + 1}, 'properties': {'pixelSize': width}, 'fields': 'pixelSize'}})
                sheets.batchUpdate(spreadsheetId=spreadsheet_id, body={'requests': requests}).execute()
                result = {'status': 'synced', 'candidates': len({row[0] for row in rows[1:]}), 'registrations': len(rows) - 1}
        except Exception as exc:
            config.data = {'error': str(exc), 'failedAt': timezone.now().isoformat()}
            config.save(update_fields=['data'])
            logger.exception('Không đồng bộ được danh sách thí sinh vào Google Sheet.')
            raise
        config.data = {**result, 'layoutVersion': LAYOUT_VERSION, 'syncedAt': timezone.now().isoformat()}
        config.save(update_fields=['data'])
        return result
