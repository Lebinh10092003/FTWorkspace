"""Apply the approved November dates and the annual 2027 work calendar."""
import copy
import json
import sqlite3
from datetime import date
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from authentication.models import SystemConfig
from authentication.monthly_sheets import set_monthly_sheet_link
from examination.models import ExamSession
from examination.work_schedule_sync import RECORD_PREFIX, examination_staff, sync_examination_work_schedule
from work_schedule.models import WorkItem
from work_schedule.sheet_routing import ANNUAL_WORKBOOKS
from work_schedule.signals import suppress_sheet_queue, queue_group

DATES = {'iaio': '2026-11-29', 'ilso': '2026-11-29', 'ibo': '2026-11-22',
         'icho': '2026-11-22', 'ipho': '2026-11-22'}
MEMBERS = ['phongnt@fermat.edu.vn', 'phuongnt@fermat.edu.vn']


def reconcile(apply=False):
    sessions = list(ExamSession.objects.filter(id__in=[f'{key}-2026-2027' for key in DATES]))
    if len(sessions) != len(DATES):
        raise CommandError('Thiếu kỳ tổ chức; chưa ghi thay đổi.')
    changed = 0
    before_groups = set(WorkItem.objects.filter(source_record_id__startswith=RECORD_PREFIX,
        work_date__gte='2026-11-01').values_list('executor_id', 'work_date'))
    generated_titles = set(WorkItem.objects.filter(source_record_id__startswith=RECORD_PREFIX,
        work_date__gte='2026-11-01').values_list('executor_id', 'work_date', 'title'))
    with transaction.atomic(), suppress_sheet_queue():
        for session in sessions:
            rounds = copy.deepcopy(session.rounds or [])
            final = next((item for item in rounds if item.get('id') == 'round-final'), None)
            if final is None:
                raise CommandError('Thiếu vòng Chung kết Quốc gia; chưa ghi thay đổi.')
            day = DATES[session.competition_id]
            if final.get('date') != day or session.national_date != day:
                changed += 1
            final['date'] = day
            final['label'] = date.fromisoformat(day).strftime('%d/%m/%Y')
            for slot in final.get('slots') or []:
                slot['date'] = day
            session.rounds = rounds
            session.national_date = day
            session.national = final['label']
            session.save(update_fields=['rounds', 'national_date', 'national', 'updated_at'])
        SystemConfig.objects.update_or_create(key='examination_schedule_staff', defaults={'data': {'members': MEMBERS}})
        url = f'https://docs.google.com/spreadsheets/d/{ANNUAL_WORKBOOKS[2027]}/edit'
        for month in range(1, 13):
            set_monthly_sheet_link('work_schedule', f'2027-{month:02}', url)
        staff = examination_staff()
        imported_duplicates = [item.pk for item in WorkItem.objects.filter(
            work_date__gte='2026-11-01', source_sheet_row__isnull=False,
            progress_note='', review_note='', status='todo',
        ).exclude(source_record_id__startswith=RECORD_PREFIX)
            if (item.executor_id, item.work_date, item.title) in generated_titles]
        if apply:
            WorkItem.objects.filter(pk__in=imported_duplicates).delete()
        summary = sync_examination_work_schedule(apply=apply)
        obsolete = WorkItem.objects.filter(source_record_id__startswith=RECORD_PREFIX,
            work_date__gte='2026-11-01').exclude(executor_id__in=[person.email for person in staff])
        obsolete_count = obsolete.count()
        if apply:
            obsolete.delete()
            groups = before_groups | set(WorkItem.objects.filter(source_record_id__startswith=RECORD_PREFIX,
                work_date__gte='2026-11-01').values_list('executor_id', 'work_date'))
            # Existing 2027 row numbers refer to the old 2026 workbook. They
            # are not proof that an item has reached the new workbook: keeping
            # them lets a blank destination look like a deliberate deletion.
            for email, day in groups:
                if day.year == 2027:
                    WorkItem.objects.filter(executor_id=email, work_date=day).update(
                        source_sheet_row=None, source_task_index=None, source_sync_hash='',
                    )
        else:
            transaction.set_rollback(True)
            groups = set()
    if apply:
        for email, day in groups:
            queue_group(email, day)
    return {'sessionsFound': len(sessions), 'datesToUpdate': changed, 'recipientCount': len(staff),
            'createdCount': len(summary['created']), 'updatedCount': len(summary['updated']),
            'removedGeneratedCount': len(summary['deleted']) + obsolete_count,
            'removedImportedDuplicateCount': len(imported_duplicates), 'applied': apply,
            '_groups': groups}


def export_calendar(extra_groups):
    from work_schedule.sheet_sync import (
        _service, _rows, _parse_date, _cell, _task_uids, _row_employee_email,
        push_groups_to_sheet, pull_from_sheet,
    )
    from work_schedule.sheet_routing import calendar_workbook
    service = _service()
    # Read the 2027 workbook before writing. Its non-exam work stays intact.
    with calendar_workbook(ANNUAL_WORKBOOKS[2027]):
        pull_from_sheet(service, date(2027, 1, 1), date(2027, 12, 31))
    groups = set(WorkItem.objects.filter(source_record_id__startswith=RECORD_PREFIX,
        work_date__gte='2026-11-01').values_list('executor_id', 'work_date'))
    # Include old dates so moved/deleted tasks disappear there too.
    groups.update(extra_groups)
    result = push_groups_to_sheet(service, groups, resolve_conflict_groups=groups)
    return {'exportedGroups': result['groups'], 'conflictCount': len(result['conflicts'])}


class Command(BaseCommand):
    help = 'Đối chiếu/cập nhật lịch thi tháng 11 và tích hợp Lịch công tác 2027; chỉ in số lượng.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--export', action='store_true')

    def handle(self, *args, **options):
        # Always prove the full plan succeeds before taking a backup or writing.
        preview = reconcile(False)
        preview.pop('_groups')
        self.stdout.write(json.dumps(preview))
        if not options['apply']:
            return
        database = settings.DATABASES['default']['NAME']
        backup_dir = Path(database).parent / 'backups'
        backup_dir.mkdir(exist_ok=True)
        backup = backup_dir / f'calendar-2027-{timezone.now():%Y%m%d-%H%M%S}.sqlite3'
        with sqlite3.connect(database) as source, sqlite3.connect(backup) as target:
            source.backup(target)
        from work_schedule.sheet_sync import sync_lease, TWO_WAY_SYNC_LEASE_SECONDS
        with sync_lease(TWO_WAY_SYNC_LEASE_SECONDS) as acquired:
            if not acquired:
                raise CommandError('Calendar sync is busy; retry after the current pass finishes.')
            result = reconcile(True)
            groups = result.pop('_groups')
            if options['export']:
                result.update(export_calendar(groups))
        self.stdout.write(json.dumps(result))
