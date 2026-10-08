from io import StringIO
import json
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from .candidate_roster_sync import HEADERS, TAB_TITLE, candidate_rows, sync_candidate_roster
from .candidate_sheet_queue import drain_candidate_sheet_queue, enqueue_candidate
from .session_sheet_queue import drain_session_sheet_queue
from .sync import PROFILE_EXPORT_HEADERS, export_session_to_google_sheet
from .models import Candidate, CandidateParticipation, CandidateSheetOutbox, Competition, ExamSession, RoundResult, ExaminationSheet, SessionSheetOutbox


class CandidateRosterSyncTests(TestCase):
    def setUp(self):
        self.competition = Competition.objects.create(
            id='roster-competition', code='SCO', name='Science Olympiad',
            parent='Test', organizer='Test', sort_key='sco',
        )
        self.session = ExamSession.objects.create(
            id='roster-session-1', competition_id=self.competition.id, code='SCO-1',
            name='Cycle 1', parent='Science Olympiad', organizer='Test',
            time='2026-2027', sort_key='sco-1',
        )
        self.legacy_session = ExamSession.objects.create(
            id='roster-session-2', competition_id=self.competition.id, code='SCO-2',
            name='Cycle 2', parent='Science Olympiad', organizer='Test',
            time='2025-2026', sort_key='sco-2',
        )
        self.candidate = Candidate.objects.create(
            id='roster-candidate', code='FT-001', name='Nguyễn Minh An',
            birth_date='2015-04-03', school='Trường A', phone='0900000000',
            session_ids=[self.session.id, self.legacy_session.id], sort_key='an',
            contests='SCO, SILSO', updated='01/10/2026 10:21', identity='000012345678', nationality='Việt Nam',
            class_name='6A', city='Hà Nội', ward='Phường A', address='Địa chỉ kiểm thử', parent='Phụ huynh A',
        )
        self.participation = CandidateParticipation.objects.create(
            candidate=self.candidate, session=self.session, subject='Toán',
        )
        RoundResult.objects.create(
            participation=self.participation, round_name='Vòng 1',
            attendance='Có mặt', result='Giải Nhất',
        )

    def test_rows_match_web_profiles_once_regardless_of_memberships(self):
        rows = candidate_rows()
        self.assertEqual(rows[0], HEADERS)
        self.assertEqual(len(rows), 2)
        self.assertEqual(len(rows[1]), 16)
        # Grade follows the class "6A" when none was entered.
        self.assertEqual(rows[1][:6], ['FT-001', 'Nguyễn Minh An', 'Trường A', '6', 'SCO, SILSO', '01/10/2026 10:21'])
        self.assertEqual(rows[1][6:11], ['03/04/2015', 'Phụ huynh A', '0900000000', '000012345678', ''])
        self.assertEqual(rows[1][11:], ['Việt Nam', '6A', 'Hà Nội', 'Phường A', 'Địa chỉ kiểm thử'])
        self.assertFalse(any('kỳ' in header.lower() for header in HEADERS))

    @patch('examination.candidate_roster_sync.build_sheets_service')
    def test_replaces_existing_parent_candidate_tab_and_restores_changed_content(self, build):
        service = MagicMock()
        build.return_value = service
        service.spreadsheets().get().execute.return_value = {'sheets': [
            {'properties': {'sheetId': 1, 'title': 'Giáo viên đối tác từng tham gia'}},
            {'properties': {'sheetId': 2, 'title': TAB_TITLE, 'gridProperties': {'rowCount': 1000, 'columnCount': 26}}},
        ]}
        service.spreadsheets().values().get().execute.side_effect = [{'values': [['Mã hồ sơ', 'Mã kỳ tổ chức']]}, {'values': candidate_rows()}]

        result = sync_candidate_roster()
        self.assertEqual(result, {'status': 'synced', 'candidates': 1, 'rows': 1})
        self.assertEqual(service.spreadsheets().values().clear.call_args.kwargs['range'], f"'{TAB_TITLE}'!A:Z")
        written = service.spreadsheets().values().update.call_args.kwargs['body']['values']
        self.assertEqual(len(written), 2)
        self.assertEqual(written[1][0], 'FT-001')
        requests = [request for call in service.spreadsheets().batchUpdate.call_args_list for request in call.kwargs['body']['requests']]
        self.assertFalse(any('addSheet' in request for request in requests))
        self.assertTrue(any(request.get('updateDimensionProperties', {}).get('properties', {}).get('hiddenByUser') is False for request in requests))
        self.assertTrue(any(request.get('repeatCell', {}).get('cell', {}).get('userEnteredFormat', {}).get('backgroundColor', {}).get('red') == 1 for request in requests))

        service.spreadsheets().get().execute.return_value = {'sheets': [
            {'properties': {'sheetId': 2, 'title': TAB_TITLE, 'gridProperties': {'rowCount': 1000}}},
        ]}
        service.spreadsheets().values().get().execute.side_effect = None
        service.spreadsheets().values().get().execute.return_value = {'values': candidate_rows()}
        self.assertEqual(sync_candidate_roster()['status'], 'unchanged')
        self.assertEqual(service.spreadsheets().values().clear.call_count, 1)

    def test_code_order_shared_parent_email_and_web_profile_are_preserved(self):
        self.candidate.email = 'parent@example.test'
        self.candidate.contests = 'SCO, SILSO'
        self.candidate.save()
        for code, name in [('FT-00010', 'A'), ('FT-00002', 'Z')]:
            Candidate.objects.create(id=code, code=code, name=name, email=self.candidate.email, sort_key=name.lower())
        before = list(Candidate.objects.order_by('pk').values())
        rows = candidate_rows()
        self.assertEqual([row[0] for row in rows[1:]], ['FT-001', 'FT-00002', 'FT-00010'])
        self.assertEqual([row[10] for row in rows[1:]], ['parent@example.test'] * 3)
        self.assertEqual(rows[1][4], 'SCO, SILSO')
        self.assertEqual(list(Candidate.objects.order_by('pk').values()), before)

    @patch('examination.candidate_sheet_queue.build_sheets_service')
    def test_events_remove_session_duplicates_sort_codes_and_keep_shared_emails(self, build):
        Candidate.objects.create(id='second', code='FT-00002', name='Second', email='shared@example.test', sort_key='a')
        self.candidate.email = 'shared@example.test'
        self.candidate.save()
        expected = candidate_rows()
        duplicate_rows = [HEADERS, expected[2], expected[1], expected[1]]
        service = build.return_value
        service.spreadsheets().get().execute.return_value = {'sheets': [{'properties': {'title': TAB_TITLE}}]}
        service.spreadsheets().values().get().execute.side_effect = [{'values': duplicate_rows}, {'values': expected}]
        drain_candidate_sheet_queue()
        self.assertEqual(CandidateSheetOutbox.objects.count(), 0)
        service.spreadsheets().values().clear.assert_called_once()
        self.assertEqual(service.spreadsheets().values().clear.call_args.kwargs['range'], f"'{TAB_TITLE}'!A4:P4")
        updates = service.spreadsheets().values().batchUpdate.call_args.kwargs['body']['data']
        self.assertEqual([item['values'][0][0] for item in updates], ['FT-001', 'FT-00002'])

    @patch('examination.candidate_sheet_queue.build_sheets_service')
    def test_verification_failure_keeps_event_for_retry(self, build):
        service = build.return_value
        service.spreadsheets().get().execute.return_value = {'sheets': [{'properties': {'title': TAB_TITLE}}]}
        service.spreadsheets().values().get().execute.return_value = {'values': [HEADERS]}
        with self.assertRaisesMessage(ValueError, 'giữ hàng đợi'):
            drain_candidate_sheet_queue()
        self.assertEqual(CandidateSheetOutbox.objects.get(candidate_id=self.candidate.pk).attempts, 1)

    @patch('examination.candidate_roster_sync.build_sheets_service')
    def test_profile_resync_preserves_mail_merge_extension_columns(self, build):
        service = build.return_value
        service.spreadsheets().get().execute.return_value = {'sheets': [{'properties': {'sheetId': 2, 'title': TAB_TITLE}}]}
        service.spreadsheets().values().get().execute.return_value = {'values': candidate_rows()}
        sync_candidate_roster(force=True)
        self.assertEqual(service.spreadsheets().values().clear.call_args.kwargs['range'], f"'{TAB_TITLE}'!A:P")
        ranges = [call.kwargs['range'] for call in service.spreadsheets().values().get.call_args_list if 'range' in call.kwargs]
        self.assertEqual(ranges, [f"'{TAB_TITLE}'!A:P"] * 2)

    @patch('examination.candidate_roster_sync.build_sheets_service')
    def test_missing_target_does_not_create_a_new_tab_or_erase_other_tabs(self, build):
        service = MagicMock()
        build.return_value = service
        service.spreadsheets().get().execute.return_value = {'sheets': [
            {'properties': {'sheetId': 1, 'title': 'Giáo viên đối tác từng tham gia'}},
        ]}
        with self.assertRaisesMessage(ValueError, TAB_TITLE):
            sync_candidate_roster()
        service.spreadsheets().batchUpdate.assert_not_called()
        service.spreadsheets().values().clear.assert_not_called()

    @patch('examination.management.commands.sync_examination_partner_contacts.sync_partner_contacts')
    def test_scheduled_command_only_exports_partners(self, partners):
        partners.return_value = {'status': 'unchanged', 'partners': 1}
        call_command('sync_examination_partner_contacts', stdout=StringIO())
        partners.assert_called_once_with(force=False)

    @patch('examination.candidate_sheet_queue.build_sheets_service')
    def test_candidate_events_upsert_only_their_rows_and_clear_queue(self, build):
        self.assertEqual(CandidateSheetOutbox.objects.filter(candidate_id=self.candidate.id).count(), 1)
        service = MagicMock()
        build.return_value = service
        service.spreadsheets().get().execute.return_value = {'sheets': [
            {'properties': {'title': TAB_TITLE, 'hidden': False}},
        ]}
        service.spreadsheets().values().get().execute.side_effect = [{'values': [HEADERS]}, {'values': candidate_rows()}]

        result = drain_candidate_sheet_queue()
        self.assertEqual(result['appended'], 1)
        self.assertEqual(CandidateSheetOutbox.objects.count(), 0)
        service.spreadsheets().values().clear.assert_not_called()
        self.assertEqual(service.spreadsheets().values().batchUpdate.call_args.kwargs['body']['data'][0]['values'][0][0], 'FT-001')
        service.spreadsheets().values().append.assert_not_called()
        ranges = [call.kwargs['range'] for call in service.spreadsheets().values().get.call_args_list if 'range' in call.kwargs]
        self.assertEqual(ranges, [f"'{TAB_TITLE}'!A:P"] * 2)

    @patch('examination.candidate_sheet_queue.build_sheets_service')
    def test_sheet_failure_retains_candidate_for_retry(self, build):
        build.side_effect = RuntimeError('temporary Google outage')
        with self.assertRaisesRegex(RuntimeError, 'temporary Google outage'):
            drain_candidate_sheet_queue()
        job = CandidateSheetOutbox.objects.get(candidate_id=self.candidate.id)
        self.assertEqual(job.attempts, 1)
        self.assertIn('temporary Google outage', job.last_error)

    @patch('examination.candidate_sheet_queue.build_sheets_service')
    def test_retry_finds_previously_written_rows_without_appending_duplicates(self, build):
        service = build.return_value
        service.spreadsheets().get().execute.return_value = {'sheets': [{'properties': {'title': TAB_TITLE}}]}
        service.spreadsheets().values().get().execute.return_value = {'values': candidate_rows()}
        self.assertEqual(drain_candidate_sheet_queue()['appended'], 0)
        service.spreadsheets().values().append.assert_not_called()

    @patch('examination.candidate_sheet_queue.build_sheets_service')
    def test_new_event_during_export_is_retained(self, build):
        service = build.return_value
        service.spreadsheets().get().execute.return_value = {'sheets': [{'properties': {'title': TAB_TITLE}}]}
        service.spreadsheets().values().get().execute.side_effect = [{'values': [HEADERS]}, {'values': candidate_rows()}]
        old_revision = CandidateSheetOutbox.objects.get(candidate_id=self.candidate.pk).revision
        service.spreadsheets().values().batchUpdate().execute.side_effect = lambda: enqueue_candidate(self.candidate.pk)
        drain_candidate_sheet_queue()
        self.assertNotEqual(CandidateSheetOutbox.objects.get(candidate_id=self.candidate.pk).revision, old_revision)

    @patch('examination.session_sheet_queue.export_session_to_google_sheet')
    def test_all_linked_sessions_append_new_candidates_and_failed_jobs_retry(self, export):
        for index, session in enumerate([self.session, self.legacy_session]):
            ExaminationSheet.objects.create(id=f'queue-source-{index}', name='Roster', url=f'https://docs.google.com/spreadsheets/d/roster-{index}',
                sheet_tab=f'Contest {index}', session_id=session.pk, stage='registration-source', created_at=timezone.now(), updated_at=timezone.now())
        self.assertEqual(SessionSheetOutbox.objects.count(), 2)
        export.side_effect = [RuntimeError('temporary outage'), {'exported': 1}]
        result = drain_session_sheet_queue()
        self.assertEqual(result['failed'], 1)
        self.assertEqual(result['synced'], 1)
        self.assertEqual(SessionSheetOutbox.objects.count(), 1)
        for call in export.call_args_list:
            self.assertEqual(call.kwargs, {'export_mode': 'refresh-selected', 'append_candidate_codes': ['FT-001'], 'validate_template': True})

    @patch('examination.session_sheet_queue.export_session_to_google_sheet')
    def test_broken_destination_does_not_block_other_tab_in_same_session(self, export):
        for index in range(2):
            ExaminationSheet.objects.create(id=f'destination-{index}', name=f'Roster {index}',
                url='https://docs.google.com/spreadsheets/d/roster', sheet_tab=f'Tab {index}',
                session_id=self.session.pk, stage='session-output', created_at=timezone.now(), updated_at=timezone.now())
        export.side_effect = [ValueError('wrong tab'), {'exported': 1}]
        result = drain_session_sheet_queue()
        self.assertEqual(export.call_count, 2)
        self.assertEqual(result['appended'], 1)
        self.assertEqual(result['failed'], 1)
        self.assertEqual(SessionSheetOutbox.objects.count(), 1)
        self.assertEqual(ExaminationSheet.objects.get(pk='destination-0').last_error, 'wrong tab')

    @patch('examination.sync.build_sheets_service')
    def test_event_export_accepts_legacy_header_hints_but_rejects_wrong_fields(self, build):
        sheet = ExaminationSheet.objects.create(id='legacy-template', name='Roster',
            url='https://docs.google.com/spreadsheets/d/roster', sheet_tab='Roster',
            session_id=self.session.pk, stage='session-output', created_at=timezone.now(), updated_at=timezone.now())
        service = build.return_value
        service.spreadsheets().get().execute.return_value = {'sheets': [{'properties': {'sheetId': 1, 'title': 'Roster'}}]}
        headers = list(PROFILE_EXPORT_HEADERS)
        headers[3] = 'Ngày sinh\n (DD/MM/YYYY hoặc YYYY)'
        headers[13] = 'Lớp đang học\n (ví dụ: 6A1)'
        service.spreadsheets().values().get().execute.side_effect = [{'values': [headers]}, {'values': []}]
        result = export_session_to_google_sheet(sheet, export_mode='append-only', validate_template=True)
        self.assertEqual(result['exported'], 1)
        service.spreadsheets().values().append.assert_called_once()
        headers[3] = 'Ngày đăng ký'
        service.spreadsheets().values().get().execute.side_effect = [{'values': [headers]}]
        with self.assertRaisesMessage(ValueError, 'chưa đúng mẫu'):
            export_session_to_google_sheet(sheet, export_mode='append-only', validate_template=True)

    @patch('examination.management.commands.sync_examination_candidate_queue.drain_session_sheet_queue')
    @patch('examination.management.commands.sync_examination_candidate_queue.drain_candidate_sheet_queue')
    def test_queue_audit_counts_pending_without_sending_data(self, contacts, sessions):
        output = StringIO()
        call_command('sync_examination_candidate_queue', audit_only=True, stdout=output)
        self.assertEqual(json.loads(output.getvalue())['remaining']['contacts'], 1)
        contacts.assert_not_called()
        sessions.assert_not_called()
