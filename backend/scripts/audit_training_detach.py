"""Read a pre-cleanup backup and encrypt the comparison for the operator.

No employee schedules or assessments are printed into public Actions logs.
Both SQLite connections are opened read-only. This script never repairs data.
"""
import base64
import json
import os
import re
import sqlite3
from collections import Counter
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


root = Path(os.getenv('WORKSPACE_DATA_DIR', '/home/workspace/ft-workspace-data'))
backup_name = os.environ['AUDIT_BACKUP_NAME']
if not re.fullmatch(r'workspace-[0-9]{8}-[0-9]{6}\.sqlite3', backup_name):
    raise ValueError('Invalid backup filename')
backup_path = root / 'backups' / backup_name
with sqlite3.connect(backup_path.as_uri() + '?mode=ro', uri=True) as old, sqlite3.connect(
    (root / 'workspace.sqlite3').as_uri() + '?mode=ro', uri=True,
) as current:
    old.row_factory = sqlite3.Row
    rows = old.execute('''
        SELECT w.id, p.name AS employee, w.executor_id, w.title, w.work_date,
               w.start_time, w.end_time, w.status, w.label, w.created_at,
               w.updated_at, w.source_sheet_row, w.source_record_id,
               w.progress_note, w.review_note, w.review_percent,
               w.training_session_id, t.source, t.title AS training_title,
               t.session_date, t.start_time AS training_start,
               t.end_time AS training_end, t.instructor_name, t.staff_name
        FROM work_schedule_workitem w
        JOIN digital_training_trainingsession t ON t.id = w.training_session_id
        JOIN authentication_userprofile p ON p.email = w.executor_id
        ORDER BY p.name, w.work_date, w.id
    ''').fetchall()
    current_work_ids = {row[0] for row in current.execute('SELECT id FROM work_schedule_workitem')}
    current.row_factory = sqlite3.Row
    current_training_ids = {row[0] for row in current.execute('SELECT id FROM digital_training_trainingsession')}
    report = []
    for raw in rows:
        row = dict(raw)
        row['workRowStillExists'] = row['id'] in current_work_ids
        row['trainingStillExists'] = row['training_session_id'] in current_training_ids
        row['titleMatches'] = row['title'] == row['training_title']
        row['dateMatches'] = row['work_date'] == row['session_date']
        row['timesMatch'] = (row['start_time'], row['end_time']) == (row['training_start'], row['training_end'])
        row['hasProgressNote'] = bool(row.pop('progress_note'))
        row['hasReviewNote'] = bool(row.pop('review_note'))
        row['workDataPreserved'] = False
        row['relationsPreserved'] = False
        if row['workRowStillExists']:
            before = dict(old.execute('SELECT * FROM work_schedule_workitem WHERE id = ?', (row['id'],)).fetchone())
            after = dict(current.execute('SELECT * FROM work_schedule_workitem WHERE id = ?', (row['id'],)).fetchone())
            for values in (before, after):
                values.pop('training_session_id', None)
                for column in ('title_format_runs',):
                    if values.get(column) is not None:
                        values[column] = json.loads(values[column])
            row['workDataPreserved'] = before == after
            row['relationsPreserved'] = all(
                sorted(entry[0] for entry in old.execute(
                    f'SELECT userprofile_id FROM work_schedule_workitem_{relation} WHERE workitem_id = ?', (row['id'],),
                )) == sorted(entry[0] for entry in current.execute(
                    f'SELECT userprofile_id FROM work_schedule_workitem_{relation} WHERE workitem_id = ?', (row['id'],),
                )) for relation in ('supporters', 'managers')
            )
        report.append(row)
    removed = [row for row in report if row['source'] != 'work_schedule' and not row['workRowStillExists']]
    queues = {}
    for table in ('examination_candidatesheetoutbox', 'examination_sessionsheetoutbox'):
        queues[table] = current.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]
    payload = json.dumps({
        'backup': backup_name, 'removedCount': len(removed),
        'removedByEmployee': dict(Counter(row['employee'] for row in removed)),
        'rows': report, 'queues': queues,
        'remainingTrainingLinks': current.execute('SELECT COUNT(*) FROM work_schedule_workitem WHERE training_session_id IS NOT NULL').fetchone()[0],
    }, ensure_ascii=False).encode()

public_key = serialization.load_der_public_key(base64.b64decode(os.environ['AUDIT_PUBLIC_KEY']))
key = AESGCM.generate_key(bit_length=256)
nonce = os.urandom(12)
encrypted = AESGCM(key).encrypt(nonce, payload, None)
wrapped = public_key.encrypt(key, padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
print('ENCRYPTED_TRAINING_AUDIT=' + json.dumps({
    'wrappedKey': base64.b64encode(wrapped).decode(),
    'nonce': base64.b64encode(nonce).decode(),
    'ciphertext': base64.b64encode(encrypted).decode(),
}))
