"""Read only FIMO schedule evidence and encrypt it for the local operator."""
import base64
import json
import os
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


ROOT = Path('/home/workspace/ft-workspace-data')


def read_database(path, *, current=False):
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
        db.execute('PRAGMA query_only=ON')
        db.row_factory = sqlite3.Row
        sessions = [dict(row) for row in db.execute('''
            SELECT id, competition_id, code, name, rounds, updated_at
            FROM examination_examsession
            WHERE lower(competition_id) LIKE '%fimo%' OR lower(code) = 'fimo'
        ''')]
        for row in sessions:
            row['rounds'] = json.loads(row['rounds'] or '[]')
        tasks = [dict(row) for row in db.execute('''
            SELECT w.id, w.title, w.work_date, w.start_time, w.end_time,
                   w.priority, w.status, w.label, w.source_record_id,
                   w.source_sheet_row, w.source_task_index, w.sync_uid,
                   w.created_at, w.updated_at, w.creator_id, w.executor_id,
                   p.name AS executor_name, w.sheet_emphasis,
                   w.progress_note != '' AS has_progress,
                   w.review_note != '' AS has_review_note, w.reviewed_at,
                   w.review_percent
            FROM work_schedule_workitem w
            JOIN authentication_userprofile p ON p.email = w.executor_id
            WHERE lower(w.title) LIKE '%fimo%'
              AND w.work_date >= '2026-09-01' AND w.work_date < '2027-08-01'
            ORDER BY w.executor_id, w.work_date, w.id
        ''')]
        report = {'database': path.name, 'sessions': sessions, 'tasks': tasks}
        if current:
            row_numbers = list({row['source_sheet_row'] for row in tasks if row['source_sheet_row']})
            events = []
            if row_numbers:
                placeholders = ','.join('?' for _ in row_numbers)
                for raw in db.execute(f'''
                    SELECT event_id, row_number, status, edited_at, editor_email,
                           received_at, processed_at, payload
                    FROM work_schedule_workschedulesheetinboundevent
                    WHERE row_number IN ({placeholders})
                    ORDER BY received_at DESC LIMIT 100
                ''', row_numbers):
                    row = dict(raw)
                    values = json.loads(row.pop('payload') or '{}').get('values') or []
                    row['sheet_date'] = values[1] if len(values) > 1 else ''
                    row['fimo_lines'] = [line for line in str(values[4] if len(values) > 4 else '').splitlines() if 'fimo' in line.lower()]
                    row['row_record_id'] = values[8] if len(values) > 8 else ''
                    row['task_uids'] = values[9] if len(values) > 9 else ''
                    events.append(row)
            report['sheet_events'] = events
            report['session_audit'] = [dict(row) for row in db.execute('''
                SELECT entity_key, content, actor_email, created_at
                FROM examination_lognote
                WHERE lower(entity_key) LIKE '%fimo%'
                ORDER BY created_at DESC LIMIT 25
            ''')]
        return report


result = {'read_at_utc': datetime.now(timezone.utc).isoformat()}
result['server_commit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
result['current'] = read_database(ROOT / 'workspace.sqlite3', current=True)
result['backups'] = []
for path in sorted((ROOT / 'backups').glob('workspace-*.sqlite3'), reverse=True)[:8]:
    try:
        result['backups'].append(read_database(path))
    except sqlite3.Error as exc:
        result['backups'].append({'database': path.name, 'error_type': type(exc).__name__})

payload = json.dumps(result, ensure_ascii=False).encode('utf-8')
public_key = serialization.load_der_public_key(base64.b64decode(os.environ['AUDIT_PUBLIC_KEY']))
key = AESGCM.generate_key(bit_length=256)
nonce = os.urandom(12)
wrapped = public_key.encrypt(key, padding.OAEP(
    mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None,
))
print(json.dumps({
    'wrappedKey': base64.b64encode(wrapped).decode(),
    'nonce': base64.b64encode(nonce).decode(),
    'ciphertext': base64.b64encode(AESGCM(key).encrypt(nonce, payload, None)).decode(),
}))
