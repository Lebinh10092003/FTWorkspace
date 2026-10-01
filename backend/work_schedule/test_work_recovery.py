import sqlite3
from contextlib import closing
from datetime import date
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management import call_command
from django.db import connection
from django.test import TestCase

from authentication.models import UserProfile
from digital_training.models import TrainingSession
from work_schedule.models import WorkItem


class WorkRecoveryTests(TestCase):
    def test_recovery_preserves_review_and_relations_and_never_overwrites_later_edits(self):
        staff = UserProfile.objects.create(email='recovery@example.com', name='Staff')
        manager = UserProfile.objects.create(email='reviewer@example.com', name='Manager')
        training = TrainingSession.objects.create(title='Training source', session_date=date(2026, 9, 12))
        item = WorkItem.objects.create(creator=manager, executor=staff,
            title='Independent preparation task', work_date=date(2026, 9, 12),
            training_session=training, status='reviewed', review_percent=100,
            review_note='Manager assessment', progress_note='Original progress', reviewed_by=manager)
        item.managers.add(manager)
        item.supporters.add(manager)
        original = {field.attname: field.value_from_object(item) for field in WorkItem._meta.concrete_fields}
        with TemporaryDirectory() as folder:
            backup = Path(folder) / 'backup.sqlite3'
            with closing(sqlite3.connect(backup)) as old:
                fields = WorkItem._meta.concrete_fields
                columns = ','.join('"' + field.column + '" TEXT' for field in fields)
                old.execute('CREATE TABLE work_schedule_workitem (' + columns + ')')
                old.execute('INSERT INTO work_schedule_workitem VALUES (' + ','.join('?' for _ in fields) + ')',
                    [field.get_db_prep_value(original[field.attname], connection) for field in fields])
                old.execute('CREATE TABLE digital_training_trainingsession (id INTEGER, source TEXT)')
                old.execute('INSERT INTO digital_training_trainingsession VALUES (?, ?)', (training.pk, training.source))
                for relation in ('supporters', 'managers'):
                    old.execute(f'CREATE TABLE work_schedule_workitem_{relation} (workitem_id INTEGER, userprofile_id TEXT)')
                    old.execute(f'INSERT INTO work_schedule_workitem_{relation} VALUES (?, ?)', (item.pk, manager.pk))
                old.commit()
            item.delete()
            args = ('restore_detached_work_items', '--backup', str(backup), '--ids', str(original['id']))
            call_command(*args, stdout=StringIO())
            self.assertFalse(WorkItem.objects.filter(pk=original['id']).exists())
            call_command(*args, '--apply', stdout=StringIO())
            restored = WorkItem.objects.get(pk=original['id'])
            for field in WorkItem._meta.concrete_fields:
                expected = None if field.attname == 'training_session_id' else original[field.attname]
                self.assertEqual(field.value_from_object(restored), expected, field.attname)
            self.assertEqual(list(restored.managers.all()), [manager])
            self.assertEqual(list(restored.supporters.all()), [manager])
            self.assertTrue(TrainingSession.objects.filter(pk=training.pk).exists())
            restored.title = 'Later edit'
            restored.save()
            call_command(*args, '--apply', stdout=StringIO())
            restored.refresh_from_db()
            self.assertEqual(restored.title, 'Later edit')
