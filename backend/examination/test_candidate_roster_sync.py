from io import StringIO
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from .candidate_roster_sync import HEADERS, TAB_TITLE, candidate_rows, sync_candidate_roster
from .models import Candidate, CandidateParticipation, Competition, ExamSession, RoundResult


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
        )
        self.participation = CandidateParticipation.objects.create(
            candidate=self.candidate, session=self.session, subject='Toán',
        )
        RoundResult.objects.create(
            participation=self.participation, round_name='Vòng 1',
            attendance='Có mặt', result='Giải Nhất',
        )

    def test_rows_include_current_and_legacy_memberships_once(self):
        rows = candidate_rows()
        self.assertEqual(rows[0], HEADERS)
        self.assertEqual(len(rows), 3)
        self.assertEqual([row[13] for row in rows[1:]], ['SCO-1', 'SCO-2'])
        self.assertEqual(rows[1][1:4], ['Nguyễn Minh An', '03/04/2015', 'Trường A'])
        self.assertEqual(rows[1][16], 'Toán')
        self.assertEqual(rows[1][20:23], ['Vòng 1', 'Vòng 1: Có mặt', 'Vòng 1: Giải Nhất'])
        self.assertEqual(rows[2][16], '')
        self.assertEqual(rows[2][19], '')

    @patch('examination.candidate_roster_sync.build_sheets_service')
    def test_replaces_existing_parent_candidate_tab_and_restores_changed_content(self, build):
        service = MagicMock()
        build.return_value = service
        service.spreadsheets().get().execute.return_value = {'sheets': [
            {'properties': {'sheetId': 1, 'title': 'Giáo viên đối tác từng tham gia'}},
            {'properties': {'sheetId': 2, 'title': TAB_TITLE, 'gridProperties': {'rowCount': 1000, 'columnCount': 26}}},
        ]}
        service.spreadsheets().values().get().execute.return_value = {'values': [['Old data']]}

        result = sync_candidate_roster()
        self.assertEqual(result, {'status': 'synced', 'candidates': 1, 'registrations': 2})
        self.assertEqual(service.spreadsheets().values().clear.call_args.kwargs['range'], f"'{TAB_TITLE}'!A:X")
        written = service.spreadsheets().values().update.call_args.kwargs['body']['values']
        self.assertEqual(len(written), 3)
        self.assertEqual(written[1][0], 'FT-001')
        requests = [request for call in service.spreadsheets().batchUpdate.call_args_list for request in call.kwargs['body']['requests']]
        self.assertFalse(any('addSheet' in request for request in requests))
        self.assertTrue(any(request.get('updateDimensionProperties', {}).get('properties', {}).get('hiddenByUser') is False for request in requests))
        self.assertTrue(any(request.get('repeatCell', {}).get('cell', {}).get('userEnteredFormat', {}).get('backgroundColor', {}).get('red') == 1 for request in requests))

        service.spreadsheets().get().execute.return_value = {'sheets': [
            {'properties': {'sheetId': 2, 'title': TAB_TITLE, 'gridProperties': {'rowCount': 1000}}},
        ]}
        service.spreadsheets().values().get().execute.return_value = {'values': candidate_rows()}
        self.assertEqual(sync_candidate_roster()['status'], 'unchanged')
        self.assertEqual(service.spreadsheets().values().clear.call_count, 1)

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

    @patch('examination.management.commands.sync_examination_partner_contacts.sync_candidate_roster')
    @patch('examination.management.commands.sync_examination_partner_contacts.sync_partner_contacts')
    def test_scheduled_command_attempts_both_exports(self, partners, candidates):
        partners.side_effect = ValueError('Partner tab unavailable')
        candidates.return_value = {'status': 'synced', 'candidates': 1, 'registrations': 2}
        with self.assertRaises(CommandError):
            call_command('sync_examination_partner_contacts', stdout=StringIO())
        candidates.assert_called_once_with(force=False)
