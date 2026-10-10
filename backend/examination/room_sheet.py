"""Room output Sheet: one tab per exam room, written one way from the web.

A separate file (stage ``room-output``) that can be shared with invigilators
and schools. Each tab holds the room's time, link and invigilators, then its
candidates with contact details, attendance and notes. Nothing is read back.
Only the A:L block of each tab is written, so columns people add on the right
stay; tabs of rooms that no longer exist are removed.
"""
import hashlib
import json
import logging
import re

from django.db.models import Count
from django.utils import timezone

from .models import ExaminationSheet, ExamInvigilationShift, ExamRoom, ExamSession, RoundResult

logger = logging.getLogger(__name__)

HEADER = ['STT', 'SBD', 'Mã FT', 'Họ và tên', 'Ngày sinh', 'Lớp', 'Trường', 'Số điện thoại', 'Email', 'Phụ huynh', 'Điểm danh', 'Ghi chú']
HEADER_ROW = 6
OVERVIEW = 'Danh sách phòng'
OVERVIEW_HEADER = ['Ca', 'Ngày thi', 'Giờ thi', 'Phòng', 'Link phòng thi', 'Giám thị', 'Số thí sinh', 'Tab danh sách']


def _date(value):
    match = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', str(value or ''))
    return f'{match[3]}/{match[2]}/{match[1]}' if match else str(value or '')


def _tab_title(text):
    return re.sub(r"[\[\]\*\?:/\\']", ' ', text).strip()[:95]


def room_tabs(session):
    """[(title, values)] in round, batch and room order; the room overview comes first."""
    rounds = [item for item in (session.rounds or []) if isinstance(item, dict)]
    round_order = {str(item.get('id')): index for index, item in enumerate(rounds)}
    slots = {str(slot.get('id')): (index, slot) for item in rounds for index, slot in enumerate(item.get('slots') or []) if isinstance(slot, dict)}
    rooms = list(ExamRoom.objects.filter(session=session).annotate(seated=Count('assignments')).filter(seated__gt=0))
    rooms.sort(key=lambda room: (round_order.get(room.round_id, 99), slots.get(room.occurrence_id, (99, {}))[0], room.position, room.room_number))
    several_rounds = len({room.round_id for room in rooms}) > 1
    tabs, overview = [], []
    for room in rooms:
        slot = slots.get(room.occurrence_id, (0, {}))[1]
        results = list(RoundResult.objects.filter(exam_room=room).select_related('participation__candidate').order_by('sbd', 'participation__candidate__name'))
        first = results[0] if results else None
        batch = str(slot.get('label') or '').strip() or (first.time_slot if first else '') or 'Ca thi'
        time_text = (first.time_slot if first and first.time_slot else str(slot.get('time') or ''))
        date_text = _date(first.exam_date if first and first.exam_date else slot.get('date'))
        invigilators = sorted({profile.name or profile.email for shift in ExamInvigilationShift.objects.filter(exam_room=room, enabled=True)
                               for profile in shift.invigilators.all()})
        title = _tab_title(f"{(room.round_name + ' - ') if several_rounds else ''}{batch} - {room.label}")
        values = [
            [f'{session.code} · {room.round_name} · {batch}' + (f' ({time_text})' if time_text else '') + (f' · {date_text}' if date_text else '')],
            [f'Phòng: {room.label}', room.link or room.exam_link or room.location],
            [f'Giám thị: {", ".join(invigilators) or "chưa phân công"}'],
            [f'Số thí sinh: {len(results)}'],
            [],
            HEADER,
        ]
        for index, result in enumerate(results, 1):
            candidate = result.participation.candidate
            values.append([index, result.sbd, candidate.code, candidate.name, _date(candidate.birth_date), candidate.class_name,
                           candidate.school, candidate.phone, candidate.email, candidate.parent,
                           result.attendance or 'Chưa điểm danh', result.note])
        tabs.append((title, values))
        overview.append([batch, date_text, time_text, room.label, room.link or room.exam_link or room.location,
                         ', '.join(invigilators) or 'chưa phân công', len(results), title])
    if not tabs:
        return []
    total = sum(row[6] for row in overview)
    return [(OVERVIEW, [[f'{session.code} · Danh sách phòng thi · {len(overview)} phòng · {total} thí sinh'], [], OVERVIEW_HEADER, *overview])] + tabs


def export_room_sheet(session_id, force=False):
    sheet = ExaminationSheet.objects.filter(session_id=session_id, stage='room-output').exclude(url='').first()
    session = ExamSession.objects.filter(pk=session_id).first()
    if not sheet or not session:
        return None
    from integrations.google_sheets import extract_spreadsheet_id
    from .invigilation import sheet_service
    tabs = room_tabs(session)
    fingerprint = hashlib.sha256(json.dumps(tabs, ensure_ascii=False, default=str).encode()).hexdigest()
    if not force and fingerprint == sheet.last_content_fingerprint:
        return {'tabs': len(tabs), 'unchanged': True}
    sid = extract_spreadsheet_id(sheet.url)
    service = sheet_service()
    existing = {item['properties']['title']: item['properties']['sheetId'] for item in
                service.spreadsheets().get(spreadsheetId=sid, fields='sheets(properties(title,sheetId))').execute()['sheets']}
    wanted = [title for title, _ in tabs]
    created = [title for title in wanted if title not in existing]
    requests = [{'addSheet': {'properties': {'title': title, 'gridProperties': {'frozenRowCount': HEADER_ROW}}}} if title != OVERVIEW
                else {'addSheet': {'properties': {'title': title, 'index': 0, 'gridProperties': {'frozenRowCount': 3}}}} for title in created]
    # Tabs this export made for rooms that are gone (same header row) are removed.
    stale = []
    for title, sheet_id in existing.items():
        if title in wanted:
            continue
        head = service.spreadsheets().values().get(spreadsheetId=sid, range=f"'{title}'!A{HEADER_ROW}:L{HEADER_ROW}").execute().get('values', [])
        if head and head[0] == HEADER:
            stale.append(sheet_id)
    if len(existing) + len(created) - len(stale) < 1:
        stale = stale[1:]  # a spreadsheet must keep one tab
    requests += [{'deleteSheet': {'sheetId': sheet_id}} for sheet_id in stale]
    if requests:
        reply = service.spreadsheets().batchUpdate(spreadsheetId=sid, body={'requests': requests}).execute()
        for answer in reply.get('replies', []):
            props = (answer.get('addSheet') or {}).get('properties')
            if props:
                existing[props['title']] = props['sheetId']
    stamp = timezone.localtime().strftime('%H:%M %d/%m/%Y')
    data, clears = [], []
    for title, values in tabs:
        values = [list(row) for row in values]
        if title == OVERVIEW:
            values[1] = [f'Cập nhật {stamp}']
        else:
            values[3] = [f'{values[3][0]} · Cập nhật {stamp}']
        data.append({'range': f"'{title}'!A1:L{len(values)}", 'values': [row + [''] * (12 - len(row)) for row in values]})
        clears.append(f"'{title}'!A{len(values) + 1}:L2000")
    if data:
        service.spreadsheets().values().batchUpdate(spreadsheetId=sid, body={'valueInputOption': 'RAW', 'data': data}).execute()
        service.spreadsheets().values().batchClear(spreadsheetId=sid, body={'ranges': clears}).execute()
    if created:
        fmt = []
        for title in created:
            sheet_id = existing[title]
            fmt += [
                {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 1}, 'cell': {'userEnteredFormat': {'textFormat': {'bold': True, 'fontSize': 12}}}, 'fields': 'userEnteredFormat.textFormat'}},
                {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': (2 if title == OVERVIEW else HEADER_ROW - 1), 'endRowIndex': (3 if title == OVERVIEW else HEADER_ROW)}, 'cell': {'userEnteredFormat': {'textFormat': {'bold': True}, 'backgroundColor': {'red': 0.9, 'green': 0.94, 'blue': 1}}}, 'fields': 'userEnteredFormat(textFormat,backgroundColor)'}},
                {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 3, 'endIndex': 4}, 'properties': {'pixelSize': 200}, 'fields': 'pixelSize'}},
                {'updateDimensionProperties': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': 6, 'endIndex': 9}, 'properties': {'pixelSize': 170}, 'fields': 'pixelSize'}},
            ]
        service.spreadsheets().batchUpdate(spreadsheetId=sid, body={'requests': fmt}).execute()
    ExaminationSheet.objects.filter(pk=sheet.pk).update(last_content_fingerprint=fingerprint, last_export_at=timezone.now(), last_error='', updated_at=timezone.now())
    return {'tabs': len(tabs), 'created': len(created), 'removed': len(stale)}


def refresh_room_sheet_safely(session_id):
    """Never lets the room Sheet block the queue or a save; the error is kept on the source."""
    try:
        return export_room_sheet(session_id)
    except Exception as exc:
        logger.warning('Không ghi được Sheet phân phòng của %s: %s', session_id, exc)
        ExaminationSheet.objects.filter(session_id=session_id, stage='room-output').update(last_error=str(exc)[:1000])
        return None
