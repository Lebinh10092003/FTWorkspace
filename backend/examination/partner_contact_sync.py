"""Mirror Examination partners into the dedicated teacher contact tab."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
import sys
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path

from django.conf import settings
from django.utils import timezone

from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service


logger = logging.getLogger(__name__)
SPREADSHEET_ID = '1MyThBsUBmOgWuUXLnDOfbIq5X9bW7TGDSIxOPlxw-Kw'
TAB_TITLE = 'Giáo viên đối tác từng tham gia'
SYNC_CONFIG_KEY = 'examination_partner_contact_sheet_sync'
HEADERS = [
    'Mã đối tác', 'Tỉnh / Thành phố', 'Phường / Xã', 'Trường', 'Cấp học',
    'Giáo viên / Đầu mối liên hệ', 'Số điện thoại', 'Email',
    'Các cuộc thi từng tham gia', 'Tổng lượt thí sinh', 'Số thí sinh theo kỳ',
]
_launch_lock = threading.Lock()
_launch_timer = None


def contact_rows(partners):
    rows = [HEADERS]
    for partner in partners:
        counts = partner.get('studentCounts') or []
        details = []
        total = 0
        for item in counts:
            if not isinstance(item, dict):
                continue
            count = max(0, int(item.get('count') or 0))
            total += count
            if str(item.get('session') or '').strip():
                details.append(f"{item['session']}: {count}")
        rows.append([
            str(partner.get('id') or ''),
            str(partner.get('province') or ''),
            str(partner.get('ward') or ''),
            str(partner.get('school') or ''),
            str(partner.get('level') or ''),
            str(partner.get('representative') or ''),
            str(partner.get('phone') or ''),
            str(partner.get('email') or ''),
            ', '.join(partner.get('contests') or []),
            total,
            '; '.join(details),
        ])
    return rows


@contextmanager
def _single_worker():
    """Prevent an older snapshot from overwriting a newer concurrent export."""
    if os.name == 'nt':
        yield
        return
    import fcntl

    path = Path(tempfile.gettempdir()) / 'ft-workspace-examination-partner-contacts.lock'
    with path.open('w') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def sync_partner_contacts(*, force=False):
    """Replace only the managed target tab with the current web records."""
    from .views import persisted_partners

    with _single_worker():
        partners = persisted_partners()
        values = contact_rows(partners)
        fingerprint = hashlib.sha256(json.dumps(values, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()
        sync_config, _ = SystemConfig.objects.get_or_create(key=SYNC_CONFIG_KEY)
        if not force and (sync_config.data or {}).get('fingerprint') == fingerprint:
            return {'status': 'unchanged', 'partners': len(partners)}

        try:
            main_config = SystemConfig.objects.filter(key='main').first()
            service = build_sheets_service('', (main_config.data if main_config else {}) or {})
            spreadsheet_id = os.getenv('EXAMINATION_PARTNER_CONTACT_SHEET_ID', SPREADSHEET_ID).strip()
            metadata = service.spreadsheets().get(
                spreadsheetId=spreadsheet_id,
                fields='sheets(properties(sheetId,title,hidden))',
            ).execute()
            target = next((sheet['properties'] for sheet in metadata.get('sheets', [])
                           if sheet.get('properties', {}).get('title') == TAB_TITLE), None)
            if target is None or target.get('hidden'):
                raise ValueError(f'Không tìm thấy sheet đang hiển thị: {TAB_TITLE}')
            escaped = "'" + TAB_TITLE.replace("'", "''") + "'"
            service.spreadsheets().values().clear(
                spreadsheetId=spreadsheet_id, range=f'{escaped}!A:K', body={},
            ).execute()
            service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id, range=f'{escaped}!A1',
                valueInputOption='RAW', body={'values': values},
            ).execute()
            service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={'requests': [
                    {'updateSheetProperties': {'properties': {
                        'sheetId': target['sheetId'], 'gridProperties': {'frozenRowCount': 1},
                    }, 'fields': 'gridProperties.frozenRowCount'}},
                    {'repeatCell': {'range': {
                        'sheetId': target['sheetId'], 'startRowIndex': 0, 'endRowIndex': 1,
                        'startColumnIndex': 0, 'endColumnIndex': len(HEADERS),
                    }, 'cell': {'userEnteredFormat': {
                        'textFormat': {'bold': True},
                        'backgroundColor': {'red': 0.89, 'green': 0.94, 'blue': 1.0},
                    }}, 'fields': 'userEnteredFormat(textFormat,backgroundColor)'}},
                ]},
            ).execute()
        except Exception as exc:
            sync_config.data = {'error': str(exc), 'failedAt': timezone.now().isoformat()}
            sync_config.save(update_fields=['data'])
            raise

        sync_config.data = {
            'fingerprint': fingerprint,
            'syncedAt': timezone.now().isoformat(),
            'partners': len(partners),
        }
        sync_config.save(update_fields=['data'])
        return {'status': 'synced', 'partners': len(partners)}


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
        subprocess.Popen([sys.executable, str(manage_py), 'sync_examination_partner_contacts'], **kwargs)
    except OSError:
        logger.exception('Không khởi chạy được đồng bộ danh bạ đối tác.')


def launch_partner_contact_sync():
    global _launch_timer
    if 'test' in sys.argv:
        return
    with _launch_lock:
        if _launch_timer:
            _launch_timer.cancel()
        _launch_timer = threading.Timer(1.0, _start_worker)
        _launch_timer.daemon = True
        _launch_timer.start()
