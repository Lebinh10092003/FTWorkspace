from datetime import date
from django.test import TestCase
from authentication.models import UserProfile
from .models import Competition, ExamSession
from .test_work_schedule_sync import a_competition, a_session, clear_seeded_exam_data
from .work_schedule_sync import examination_staff, planned_entries, sync_examination_work_schedule
from work_schedule.models import WorkItem
from authentication.models import SystemConfig
from .management.commands.reconcile_calendar_2027 import reconcile, DATES


class GroupedExamCalendarTests(TestCase):
    def setUp(self):
        clear_seeded_exam_data()

    def add(self, code, organizer, round_name='Vòng Chung kết Quốc gia'):
        comp = a_competition(code.lower(), code, code)
        Competition.objects.filter(pk=comp.pk).update(organizer=organizer)
        a_session(f'{code.lower()}-2026-2027', comp.pk, rounds=[{
            'id': 'round-final', 'name': round_name, 'date': '2026-11-22', 'slots': [],
        }])

    def test_same_organizer_and_day_is_one_line(self):
        for code in ('SIPhO', 'SIChO', 'SIBO'):
            self.add(code, 'SCO')
        entries = planned_entries()
        self.assertEqual(len(entries), 1)
        for code in ('SIPhO', 'SIChO', 'SIBO'):
            self.assertIn(code, entries[0]['title'])
        self.assertEqual(len(entries[0]['memberRecordIds']), 3)

    def test_different_organizers_stay_separate(self):
        self.add('SIBO', 'SCO')
        self.add('FIMO', 'Fermat')
        self.assertEqual(len(planned_entries()), 2)

    def test_different_rounds_still_fit_one_organizer_day(self):
        self.add('SIAIO', 'SCO')
        self.add('SILSO', 'SCO', 'Vòng thi Quốc gia duy nhất')
        self.assertEqual(len(planned_entries()), 1)
        self.assertIn('SILSO', planned_entries()[0]['title'])

    def test_supervisors_receive_the_calendar_without_department_membership(self):
        for email in ('thuanld@fermat.edu.vn', 'dungpv@fermat.edu.vn'):
            UserProfile.objects.update_or_create(email=email, defaults={'name': email, 'employment_status': 'ACTIVE'})
        self.assertCountEqual([p.email for p in examination_staff()], ['thuanld@fermat.edu.vn', 'dungpv@fermat.edu.vn'])

    def test_explicit_members_override_broad_department_access(self):
        SystemConfig.objects.update_or_create(key='examination_schedule_staff', defaults={'data': {'members': ['member@example.com']}})
        UserProfile.objects.create(email='member@example.com', name='Member')
        self.assertIn('member@example.com', [p.email for p in examination_staff()])

    def test_date_reconciliation_dry_run_rolls_back_all_configuration(self):
        for key in DATES:
            self.add(key.upper(), 'SCO')
        before = list(ExamSession.objects.values_list('rounds', flat=True))
        report = reconcile(False)
        self.assertFalse(report['applied'])
        self.assertEqual(report['sessionsFound'], 5)
        after = list(ExamSession.objects.values_list('rounds', flat=True))
        self.assertEqual(before, after)
        self.assertFalse(SystemConfig.objects.filter(key='examination_schedule_staff').exists())

    def test_reconciliation_removes_only_exact_unworked_imported_duplicates(self):
        for key in DATES:
            self.add(key.upper(), 'SCO')
        UserProfile.objects.update_or_create(email='phongnt@fermat.edu.vn', defaults={'name': 'Phong'})
        SystemConfig.objects.update_or_create(key='examination_schedule_staff', defaults={'data': {'members': ['phongnt@fermat.edu.vn']}})
        sync_examination_work_schedule(today=date(2026, 11, 1))
        generated = WorkItem.objects.filter(executor_id='phongnt@fermat.edu.vn', source_record_id__startswith='REC-EXAM-').first()
        duplicate = WorkItem.objects.create(creator=generated.creator, executor=generated.executor,
            title=generated.title, work_date=generated.work_date, source_sheet_row=2000, source_record_id='REC-WEB-COPY')
        unrelated = WorkItem.objects.create(creator=generated.creator, executor=generated.executor,
            title='Chuẩn bị tài liệu', work_date=generated.work_date, source_sheet_row=2000)
        self.assertEqual(reconcile(False)['removedImportedDuplicateCount'], 1)
        self.assertTrue(WorkItem.objects.filter(pk=duplicate.pk).exists())
        reconcile(True)
        self.assertFalse(WorkItem.objects.filter(pk=duplicate.pk).exists())
        self.assertTrue(WorkItem.objects.filter(pk=unrelated.pk).exists())

    def test_annual_transfer_detaches_old_workbook_rows_without_losing_notes(self):
        for key in DATES:
            self.add(key.upper(), 'SCO')
        a_competition('fimo', 'FIMO', 'FIMO')
        a_session('fimo-2026-2027', 'fimo', rounds=[{'id': 'round-final', 'name': 'Vòng Chung kết Quốc gia', 'date': '2027-04-25'}])
        person, _ = UserProfile.objects.update_or_create(email='phongnt@fermat.edu.vn', defaults={'name': 'Phong'})
        item = WorkItem.objects.create(creator=person, executor=person, title='Tổ chức Vòng Chung kết Quốc gia Cuộc thi FIMO – Năm học 2026-2027',
            work_date='2027-04-25', source_record_id='REC-EXAM-fimo-2026-2027-round-final-0', source_sheet_row=2260,
            source_sync_hash='old-file-hash', progress_note='Đã chuẩn bị')
        reconcile(True)
        item.refresh_from_db()
        self.assertIsNone(item.source_sheet_row)
        self.assertEqual(item.source_sync_hash, '')
        self.assertEqual(item.progress_note, 'Đã chuẩn bị')
