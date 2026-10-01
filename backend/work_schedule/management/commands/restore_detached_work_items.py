"""Recover explicitly selected deleted tasks, without reconnecting calendars."""
import json
import re
import sqlite3
from contextlib import closing
from datetime import timezone as datetime_timezone
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import models, transaction
from django.utils import timezone

from authentication.models import UserProfile
from work_schedule.models import WorkItem


class Command(BaseCommand):
    help = 'Restore selected deleted work items and assessments from a pre-cleanup SQLite backup.'

    def add_arguments(self, parser):
        parser.add_argument('--backup', required=True)
        parser.add_argument('--ids', required=True)
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        if not re.fullmatch(r'[0-9]+(?:,[0-9]+)*', options['ids']):
            raise CommandError('Explicit comma-separated numeric IDs are required')
        ids = sorted(set(map(int, options['ids'].split(','))))
        path = Path(options['backup']).resolve()
        if not path.is_file():
            raise CommandError('Backup is missing')
        fields = WorkItem._meta.concrete_fields
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as old:
            old.row_factory = sqlite3.Row
            placeholders = ','.join('?' for _ in ids)
            rows = old.execute(
                f'SELECT * FROM work_schedule_workitem WHERE id IN ({placeholders})', ids,
            ).fetchall()
            if len(rows) != len(ids):
                raise CommandError('Some selected IDs are absent from backup')
            recovered = []
            for row in rows:
                source = old.execute('SELECT source FROM digital_training_trainingsession WHERE id = ?',
                                     (row['training_session_id'],)).fetchone()
                if not source or source['source'] == 'work_schedule':
                    raise CommandError('Selected task was not linked to an internal training calendar')
                if any(field.column not in row.keys() for field in fields):
                    raise CommandError('Backup schema does not match current task schema')
                values = {}
                for field in fields:
                    raw = row[field.column]
                    if isinstance(field, models.JSONField) and raw is not None:
                        raw = json.loads(raw)
                    value = field.to_python(raw)
                    # Django's SQLite timestamps are stored as naive UTC.
                    if isinstance(field, models.DateTimeField) and value is not None and timezone.is_naive(value):
                        value = timezone.make_aware(value, datetime_timezone.utc)
                    values[field.attname] = value
                values['training_session_id'] = None
                relations = {}
                for relation in ('supporters', 'managers'):
                    relations[relation] = [entry[0] for entry in old.execute(
                        f'SELECT userprofile_id FROM work_schedule_workitem_{relation} WHERE workitem_id = ?',
                        (row['id'],),
                    )]
                profile_ids = {values[key] for key in ('creator_id', 'executor_id', 'reviewed_by_id') if values[key]}
                profile_ids.update(email for emails in relations.values() for email in emails)
                if UserProfile.objects.filter(pk__in=profile_ids).count() != len(profile_ids):
                    raise CommandError('An original staff account is missing; no data was changed')
                recovered.append((values, relations))

        def missing_rows():
            missing = []
            for values, relations in recovered:
                existing = WorkItem.objects.filter(pk=values['id']).first()
                if existing:
                    if existing.sync_uid != values['sync_uid']:
                        raise CommandError('Task ID has been reused; no data was changed')
                    continue  # Never replace later edits on a task already recovered.
                if WorkItem.objects.filter(sync_uid=values['sync_uid']).exists():
                    raise CommandError('Task already exists under another ID; no data was changed')
                missing.append((values, relations))
            return missing

        missing = missing_rows()
        result = {'selected': len(ids), 'missing': len(missing), 'restored': 0, 'applied': options['apply']}
        if options['apply'] and missing:
            # Take a complete fresh snapshot before making the targeted repair.
            current_path = Path(settings.DATABASES['default']['NAME'])
            if current_path.is_file():
                snapshot = current_path.parent / 'backups' / ('before-work-recovery-' + timezone.now().strftime('%Y%m%d-%H%M%S-%f') + '.sqlite3')
                snapshot.parent.mkdir(parents=True, exist_ok=True)
                with closing(sqlite3.connect(str(current_path))) as current, closing(sqlite3.connect(str(snapshot))) as target:
                    current.backup(target)
            with transaction.atomic():
                for values, relations in missing_rows():
                    item = WorkItem(**values)
                    item.save(force_insert=True)
                    # save() assigns timestamps and normalises formatting; the
                    # recovery must retain the exact original persisted values.
                    WorkItem.objects.filter(pk=item.pk).update(**values)
                    for relation, emails in relations.items():
                        getattr(item, relation).set(emails)
                    result['restored'] += 1
        self.stdout.write(json.dumps(result))
