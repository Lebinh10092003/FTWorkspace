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

from .candidate_roster_sync import HEADERS, TAB_TITLE, candidate_rows
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
    # A competition code can be reused in several years/organisation batches.
    return tuple(row[index] if len(row) > index else '' for index in (0, 13, 14, 15))


def drain_candidate_sheet_queue(*, limit=100):
    """Upsert only queued candidate rows; leave jobs intact after any failed write."""
    with _single_worker():
        jobs = list(CandidateSheetOutbox.objects.order_by('attempts', 'enqueued_at')[:limit])
        if not jobs:
            return {'status': 'empty', 'candidates': 0, 'rows': 0}
        ids = [job.candidate_id for job in jobs]
        proposed = candidate_rows(ids)[1:]
        try:
            config = SystemConfig.objects.filter(key='main').first()
            service = build_sheets_service('', (config.data if config else {}) or {})
            spreadsheet_id = os.getenv('EXAMINATION_PARTNER_CONTACT_SHEET_ID', SPREADSHEET_ID).strip()
            sheets = service.spreadsheets()
            metadata = sheets.get(spreadsheetId=spreadsheet_id, fields='sheets(properties(title,hidden))').execute()
            target = next((item['properties'] for item in metadata.get('sheets', [])
                           if item.get('properties', {}).get('title') == TAB_TITLE), None)
            if target is None or target.get('hidden'):
                raise ValueError(f'Không tìm thấy tab đang hiển thị: {TAB_TITLE}')
            tab = "'" + TAB_TITLE.replace("'", "''") + "'"
            current = sheets.values().get(spreadsheetId=spreadsheet_id, range=f'{tab}!A:X').execute().get('values', [])
            if not current or current[0] != HEADERS:
                raise ValueError('Cấu trúc tab thí sinh đã thay đổi; cần kiểm tra trước khi ghi.')
            existing = {}
            for number, row in enumerate(current[1:], start=2):
                if row and row[0]:
                    existing.setdefault(_row_key(row), (number, row))
            updates = []
            appends = []
            for row in proposed:
                key = _row_key(row)
                found = existing.get(key)
                if not found and row[13]:
                    found = existing.pop((row[0], '', '', ''), None)
                if found:
                    if not _same_row(found[1], row):
                        updates.append({'range': f'{tab}!A{found[0]}:X{found[0]}', 'values': [row]})
                else:
                    appends.append(row)
                    existing[key] = (None, row)
            if updates:
                sheets.values().batchUpdate(
                    spreadsheetId=spreadsheet_id,
                    body={'valueInputOption': 'RAW', 'data': updates},
                ).execute()
            if appends:
                sheets.values().append(
                    spreadsheetId=spreadsheet_id, range=f'{tab}!A:X',
                    valueInputOption='RAW', insertDataOption='INSERT_ROWS',
                    body={'values': appends},
                ).execute()
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
