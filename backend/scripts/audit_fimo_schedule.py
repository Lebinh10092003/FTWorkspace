"""Read-only FIMO diagnosis. Export only anonymous counts and calendar dates."""
import json
import re
import sqlite3
import subprocess
from pathlib import Path

ROOT = Path('/home/workspace/ft-workspace-data')

def module(value):
    value = str(value or '')
    return 'examination' if value.startswith('REC-EXAM-') else 'web_row' if value.startswith('REC-WEB-') else 'sheet_row' if value else 'empty'

def connect(path):
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    db.execute('PRAGMA query_only=ON')
    db.row_factory = sqlite3.Row
    return db

with connect(ROOT / 'workspace.sqlite3') as db:
    sessions = list(db.execute("SELECT id, rounds FROM examination_examsession WHERE id='fimo-2026-2027'"))
    session_days = []
    for session in sessions:
        for round_data in json.loads(session['rounds'] or '[]'):
            if round_data.get('id') != 'round-national':
                continue
            slots = round_data.get('slots') or []
            session_days = [str(slot.get('date') or '') for slot in slots if isinstance(slot, dict)] or [str(round_data.get('date') or '')]
    rows = [dict(row) for row in db.execute("""
        SELECT w.id, w.title, w.work_date, w.priority, w.source_record_id,
               w.source_sheet_row
        FROM work_schedule_workitem w
        WHERE w.work_date='2026-10-11' AND lower(w.title) LIKE '%fimo%'
    """)]
    # No titles, people, emails, note text, assessments, row IDs, or UUIDs leave this process.
    task_metadata = []
    for row in sorted(rows, key=lambda row: row['id']):
        batch_match = re.search(r'(?:đợt|Đợt)\s*(\d+)', row['title'])
        task_metadata.append({
            'batch_number': int(batch_match.group(1)) if batch_match else None,
            'generated_title_shape': row['title'].startswith('Tổ chức ') and '(Đợt ' in row['title'],
            'day': row['work_date'], 'priority': row['priority'], 'source_module': module(row['source_record_id']),
        })
    source_rows = sorted({row['source_sheet_row'] for row in rows if row['source_sheet_row']})
    sheet_evidence = []
    if source_rows:
        placeholders = ','.join('?' for _ in source_rows)
        for event in db.execute(f"""
            SELECT payload FROM work_schedule_workschedulesheetinboundevent
            WHERE row_number IN ({placeholders}) ORDER BY received_at DESC LIMIT 30
        """, source_rows):
            values = json.loads(event['payload'] or '{}').get('values') or []
            lines = [line for line in str(values[4] if len(values)>4 else '').splitlines() if 'fimo' in line.lower()]
            if lines:
                sheet_evidence.append({'day': str(values[1]) if len(values)>1 else '',
                                       'fimo_line_count': len(lines),
                                       'source_module': module(values[8] if len(values)>8 else '')})
    result = {'server_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
              'national_calendar_days': session_days, 'pictured_day_task_metadata': task_metadata,
              'sheet_event_evidence': sheet_evidence}
    ids = [row['id'] for row in rows]
    result['backup_evidence'] = []
    for rank, path in enumerate(sorted((ROOT/'backups').glob('workspace-*.sqlite3'),reverse=True)[:8],1):
        try:
            with connect(path) as old:
                if ids:
                    placeholders=','.join('?' for _ in ids)
                    old_rows=list(old.execute(f'SELECT id, work_date, priority, source_record_id FROM work_schedule_workitem WHERE id IN ({placeholders})',ids))
                else:
                    old_rows=[]
                old_by_id={row['id']:row for row in old_rows}
                source_changes=sum(1 for row in rows if row['id'] in old_by_id and module(row['source_record_id']) != module(old_by_id[row['id']]['source_record_id']))
                result['backup_evidence'].append({'recency_rank':rank, 'matching_task_count':len(old_rows),
                    'examination_source_count':sum(1 for row in old_rows if module(row['source_record_id'])=='examination'),
                    'priority_high_count':sum(1 for row in old_rows if row['priority']=='high'),
                    'source_module_changed_count':source_changes,
                    'pictured_day_count':sum(1 for row in old_rows if row['work_date']=='2026-10-11')})
        except sqlite3.Error:
            result['backup_evidence'].append({'recency_rank':rank,'readable':False})
print(json.dumps(result,ensure_ascii=True))
