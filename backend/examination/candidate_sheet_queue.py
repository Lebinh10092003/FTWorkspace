"""Event-driven, retryable candidate backup to the shared Google Sheet."""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import uuid

from django.conf import settings
from django.db import transaction
from django.db.models import F

from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service

from .candidate_roster_sync import HEADERS, TAB_TITLE, _sheet_values_equal, candidate_rows
from .models import CandidateSheetOutbox
from .partner_contact_sync import SPREADSHEET_ID, _single_worker


logger = logging.getLogger(__name__)
_launch_lock = threading.Lock()
_launch_timer = None


def enqueue_candidate(candidate_id):
    """Store the request in the same DB transaction as the candidate change."""
    CandidateSheetOutbox.objects.update_or_create(
        candidate_id=str(candidate_id), defaults={'revision': uuid.uuid4(), 'attempts': 0, 'last_error': ''},
    )
    transaction.on_commit(launch_candidate_sheet_worker)


def _start_worker():
    global _launch_timer
    with _launch_lock:
        _launch_timer = None
    manage_py = settings.BASE_DIR / 'manage.py'
    kwargs = {'cwd': str(settings.BASE_DIR), 'stdout': subprocess.DEVNULL, 'stderr': subprocess.DEVNULL}
    if os.name == 'nt':
        kwargs['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        kwargs['start_new_session'] = True
    try:
        subprocess.Popen([sys.executable, str(manage_py), 'sync_examination_candidate_queue'], **kwargs)
    except OSError:
        logger.exception('Không khởi chạy được hàng đợi đồng bộ thí sinh.')


def launch_candidate_sheet_worker():
    global _launch_timer
    if 'test' in sys.argv:
        return
    with _launch_lock:
        if _launch_timer:
            _launch_timer.cancel()
        _launch_timer = threading.Timer(2.0, _start_worker)
        _launch_timer.daemon = True
        _launch_timer.start()


def _same_row(current, proposed):
    return list(current) == list(proposed)[:len(current)] and not any(
        value not in ('', None) for value in proposed[len(current):]
    )


def _row_key(row):
    return str(row[0] if row else '').strip().casefold()


def drain_candidate_sheet_queue(*, limit=100):
    """Process events and reconcile profile rows in web order; retry failed writes."""
    with _single_worker():
        jobs = list(CandidateSheetOutbox.objects.order_by('attempts', 'enqueued_at')[:limit])
        if not jobs:
            return {'status': 'empty', 'candidates': 0, 'rows': 0}
        ids = [job.candidate_id for job in jobs]
        try:
            proposed = candidate_rows()[1:]
            config = SystemConfig.objects.filter(key='main').first()
            service = build_sheets_service('', (config.data if config else {}) or {})
            spreadsheet_id = os.getenv('EXAMINATION_PARTNER_CONTACT_SHEET_ID', SPREADSHEET_ID).strip()
            sheets = service.spreadsheets()
            metadata = sheets.get(spreadsheetId=spreadsheet_id, fields='sheets(properties(sheetId,title,hidden,gridProperties))').execute()
            target = next((item['properties'] for item in metadata.get('sheets', [])
                           if item.get('properties', {}).get('title') == TAB_TITLE), None)
            if target is None or target.get('hidden'):
                raise ValueError(f'Không tìm thấy tab đang hiển thị: {TAB_TITLE}')
            tab = "'" + TAB_TITLE.replace("'", "''") + "'"
            current = sheets.values().get(spreadsheetId=spreadsheet_id, range=f'{tab}!A:P').execute().get('values', [])
            if not current or current[0] != HEADERS:
                raise ValueError('Cấu trúc tab thí sinh đã thay đổi; cần chạy đồng bộ danh sách chuẩn trước khi ghi.')
            expected = [HEADERS, *proposed]
            existing_codes = {_row_key(row) for row in current[1:] if _row_key(row)}
            appends = [row for row in proposed if _row_key(row) not in existing_codes]
            updates = []
            # Sorted canonical rows also remove legacy per-session duplicates.
            # Write changed positions only; shared emails never identify a row.
            for number, row in enumerate(expected, start=1):
                previous = current[number - 1] if number <= len(current) else []
                if not _same_row(previous, row):
                    updates.append({'range': f'{tab}!A{number}:P{number}', 'values': [row]})
            grid = target.get('gridProperties', {})
            if len(expected) > grid.get('rowCount', 1000):
                sheets.batchUpdate(spreadsheetId=spreadsheet_id, body={'requests': [
                    {'updateSheetProperties': {'properties': {'sheetId': target['sheetId'], 'gridProperties': {'rowCount': len(expected)}}, 'fields': 'gridProperties.rowCount'}},
                ]}).execute()
            for start in range(0, len(updates), 300):
                sheets.values().batchUpdate(spreadsheetId=spreadsheet_id,
                    body={'valueInputOption': 'RAW', 'data': updates[start:start + 300]}).execute()
            if len(current) > len(expected):
                sheets.values().clear(spreadsheetId=spreadsheet_id, range=f'{tab}!A{len(expected) + 1}:P{len(current)}', body={}).execute()
            verified = sheets.values().get(spreadsheetId=spreadsheet_id, range=f'{tab}!A:P').execute().get('values', [])
            if not _sheet_values_equal(verified, expected):
                raise ValueError('Sheet chưa khớp danh sách thí sinh trên web; giữ hàng đợi để thử lại.')
        except Exception as exc:
            CandidateSheetOutbox.objects.filter(candidate_id__in=ids).update(
                attempts=F('attempts') + 1, last_error=str(exc)[:1000],
            )
            logger.exception('Đồng bộ hàng đợi thí sinh vào Google Sheet thất bại.')
            raise
        for job in jobs:
            CandidateSheetOutbox.objects.filter(
                candidate_id=job.candidate_id, revision=job.revision,
            ).delete()
        return {'status': 'synced', 'candidates': len(jobs), 'rows': len(proposed),
                'updated': len(updates), 'appended': len(appends)}
