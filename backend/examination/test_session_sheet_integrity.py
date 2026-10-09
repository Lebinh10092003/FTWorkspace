"""Regression coverage for session isolation, identifiers and existing-row updates."""
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from .models import Candidate, CandidateParticipation, ExamSession, ExaminationSheet, RoundResult
from .sync import (EXPORT_HEADERS, PROFILE_EXPORT_HEADERS, candidate_body_format_requests,
                   export_session_to_google_sheet, format_identity, format_phone, session_export_rows)


class SessionSheetIntegrityTests(TestCase):
    def setUp(self):
        self.session = ExamSession.objects.create(id='integrity', competition_id='FIMO', code='FIMO',
            name='Current year', parent='FT', organizer='FT', time='2026-2027', sort_key='1',
            rounds=[{'id': 'qualifying', 'name': 'Vòng loại Quốc gia'},
                    {'id': 'national', 'name': 'Chung kết Quốc gia'}])
        self.candidate = Candidate.objects.create(id='integrity-profile', code='FT-90000', name='Nguyễn An',
            identity='22215012671', phone='859773086', achievement='Vàng', updated='22/08/2026 13:33', sort_key='1')
        self.participation = CandidateParticipation.objects.create(candidate=self.candidate, session=self.session)

    def test_identifiers_are_normalized_at_storage_and_export_boundaries(self):
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.identity, '022215012671')
        self.assertEqual(self.candidate.phone, '0859773086')
        for raw in ("'001213068330", '*001213068330', ',001213068330.'):
            self.assertEqual(format_identity(raw), '001213068330')
        self.assertEqual(format_identity('0'), '')
        self.assertEqual(format_identity('.'), '')
        self.assertEqual(format_identity('B1234567'), 'B1234567')
        self.assertEqual(format_phone('0986096894/ 0973213868'), '0986096894 / 0973213868')
        self.assertEqual(format_phone('09860968940973213868'), '0986096894 / 0973213868')

    def test_same_name_sheet_row_with_another_code_does_not_block_appending(self):
        from .sync import _aligned_export_rows
        twin = Candidate.objects.create(id='integrity-twin', code='FT-90001', name='Nguyễn An',
            birth_date='2014-08-12', identity='001214004150', sort_key='2')
        CandidateParticipation.objects.create(candidate=twin, session=self.session)
        rows = session_export_rows(self.session.pk)[2:]
        existing = next(row for row in rows if row[1] == 'FT-90000')
        alignment = _aligned_export_rows([existing], self.session.pk)
        self.assertEqual(alignment['matchConflicts'], [])
        self.assertEqual([row[1] for row in alignment['appendedValues']], ['FT-90001'])
        # A hand-typed row without a code is still treated as a possible duplicate.
        codeless = list(existing)
        codeless[1] = ''
        codeless[4] = codeless[7] = codeless[8] = ''
        alignment = _aligned_export_rows([codeless], self.session.pk)
        self.assertTrue(alignment['matchConflicts'])

    def test_eligibility_scores_and_previous_session_medal_do_not_award_current_round(self):
        RoundResult.objects.create(participation=self.participation, round_id='qualifying',
            round_name='Vòng loại Quốc gia', eligibility='Đủ điều kiện', score='90')
        row = session_export_rows(self.session.pk)[2]
        self.assertEqual(row[66:68], ['', ''])
        self.assertEqual(row[69], timezone.localtime(self.participation.created_at).strftime('%d/%m/%Y %H:%M'))
        self.assertNotEqual(row[69], self.candidate.updated)

    def test_only_actual_awards_in_completed_rounds_count(self):
        RoundResult.objects.create(participation=self.participation, round_id='qualifying',
            round_name='Vòng loại Quốc gia', exam_date='2020-01-01', result='Bạc')
        later = RoundResult.objects.create(participation=self.participation, round_id='national',
            round_name='Chung kết Quốc gia', exam_date='2999-01-01', result='Vàng')
        self.assertEqual(session_export_rows(self.session.pk)[2][66:68], ['Vòng 1 – Vòng loại Quốc gia', 'Bạc'])
        later.exam_date = '2020-02-01'
        later.result = 'Không có giải'
        later.save()
        self.assertEqual(session_export_rows(self.session.pk)[2][66:68], ['Vòng 1 – Vòng loại Quốc gia', 'Bạc'])
        later.result = 'Vàng'
        later.save()
        self.assertEqual(session_export_rows(self.session.pk)[2][66:68], ['Vòng 2 – Chung kết Quốc gia', 'Vàng'])

    def test_multiple_occurrences_never_spill_into_other_round_columns(self):
        for date, award in [('2020-01-01', 'Bạc'), ('2020-02-01', 'Vàng')]:
            RoundResult.objects.create(participation=self.participation, round_id='qualifying',
                round_name='Vòng loại Quốc gia', occurrence_id=date, exam_date=date, result=award)
        row = session_export_rows(self.session.pk)[2]
        self.assertEqual(row[34], 'Vàng')
        self.assertEqual(row[36:51], [''] * 15)
        self.assertEqual(row[66:68], ['Vòng 1 – Vòng loại Quốc gia', 'Vàng'])

    @patch('examination.sync.build_sheets_service')
    def test_refresh_fills_missing_code_and_existing_profile_without_reordering_or_deleting(self, build):
        sheet = ExaminationSheet.objects.create(id='integrity-output', name='FIMO',
            url='https://docs.google.com/spreadsheets/d/integrity', sheet_tab='FIMO',
            session_id=self.session.pk, stage='session-output', created_at=timezone.now(), updated_at=timezone.now())
        row = session_export_rows(self.session.pk)[2]
        row[0] = '1'
        current = list(row)
        current[1] = ' '
        current[4] = ''
        unrelated = ['2', 'UNKNOWN', 'Other person']
        service = build.return_value
        service.spreadsheets().get().execute.return_value = {'sheets': [{'properties': {'sheetId': 8, 'title': 'FIMO'}}]}
        service.spreadsheets().values().get().execute.side_effect = [
            {'values': [PROFILE_EXPORT_HEADERS]}, {'values': [current, unrelated]}, {'values': [row, unrelated]}]
        result = export_session_to_google_sheet(sheet, export_mode='refresh-selected',
            append_candidate_codes=[self.candidate.code], validate_template=True)
        self.assertEqual(result['updated'], 1)
        self.assertEqual(result['exported'], 0)
        data = service.spreadsheets().values().batchUpdate.call_args.kwargs['body']['data']
        self.assertEqual(data, [{'range': "'FIMO'!A3:BR3", 'values': [row]}])
        service.spreadsheets().values().clear.assert_not_called()
        service.spreadsheets().values().append.assert_not_called()
        requests = service.spreadsheets().batchUpdate.call_args.kwargs['body']['requests']
        self.assertTrue(all(item['repeatCell']['range']['startRowIndex'] == 2 for item in requests))

    @patch('examination.sync.build_sheets_service')
    def test_stt_gaps_left_by_removed_rows_are_closed_in_place(self, build):
        # FIMO 09/10/2026: 230 rows numbered up to 278 after removed candidates' rows were deleted.
        sheet = ExaminationSheet.objects.create(id='stt-output', name='FIMO',
            url='https://docs.google.com/spreadsheets/d/integrity', sheet_tab='FIMO',
            session_id=self.session.pk, stage='session-output', created_at=timezone.now(), updated_at=timezone.now())
        twin = Candidate.objects.create(id='stt-new', code='FT-90002', name='Trần Bình', birth_date='2014-01-01', sort_key='3')
        CandidateParticipation.objects.create(candidate=twin, session=self.session)
        row = next(r for r in session_export_rows(self.session.pk)[2:] if r[1] == 'FT-90000')
        row[0] = '5'
        other = ['9', 'FT-OTHER', 'Người trên Sheet']
        blank = []
        expected_new = next(r for r in session_export_rows(self.session.pk)[2:] if r[1] == 'FT-90002')
        service = build.return_value
        service.spreadsheets().get().execute.return_value = {'sheets': [{'properties': {'sheetId': 8, 'title': 'FIMO'}}]}
        fixed = [list(row), list(other), blank, list(expected_new)]
        fixed[0][0], fixed[1][0], fixed[3][0] = 1, 2, 3
        service.spreadsheets().values().get().execute.side_effect = [
            {'values': [PROFILE_EXPORT_HEADERS]}, {'values': [row, other, blank]}, {'values': fixed}]
        result = export_session_to_google_sheet(sheet, export_mode='refresh-selected',
            append_candidate_codes=['FT-90002'], validate_template=True)
        self.assertEqual((result['exported'], result['updated']), (1, 0))
        data = service.spreadsheets().values().batchUpdate.call_args.kwargs['body']['data']
        stt = {item['range']: item['values'] for item in data if item['range'].count('!A') and ':' not in item['range']}
        self.assertEqual(stt, {"'FIMO'!A3": [[1]], "'FIMO'!A4": [[2]]})
        appended = next(item for item in data if item['range'].startswith("'FIMO'!A6:"))
        self.assertEqual(appended['values'][0][0], 3)
        service.spreadsheets().values().clear.assert_not_called()

    def test_body_format_does_not_copy_header_or_change_dimensions(self):
        requests = candidate_body_format_requests(8, 2, 60)
        body = requests[0]['repeatCell']
        self.assertEqual(body['range']['endColumnIndex'], len(EXPORT_HEADERS))
        self.assertEqual(body['cell']['userEnteredFormat']['wrapStrategy'], 'CLIP')
        self.assertEqual(body['cell']['userEnteredFormat']['horizontalAlignment'], 'LEFT')
        self.assertEqual(body['cell']['userEnteredFormat']['backgroundColor']['red'], 1)

    @patch('examination.sync.build_sheets_service')
    def test_two_round_template_preserves_both_subjects_for_one_profile(self, build):
        from .sync import SUMMARY_EXPORT_HEADERS
        sheet = ExaminationSheet.objects.create(id='legacy-output', name='AYSBC',
            url='https://docs.google.com/spreadsheets/d/integrity', sheet_tab='AYSBC',
            session_id=self.session.pk, stage='session-output', created_at=timezone.now(), updated_at=timezone.now())
        headers = EXPORT_HEADERS[:51] + SUMMARY_EXPORT_HEADERS + [SUMMARY_EXPORT_HEADERS[3]]
        self.candidate.birth_date = '2014-02-10'
        self.candidate.save()
        rows = []
        for subject, award in [('Botany', 'Gold'), ('Mathematics', '')]:
            row = session_export_rows(self.session.pk)[2][:51] + ['', '', '', 'old', 'old']
            row[1], row[15], row[23], row[30], row[34] = '', subject, '2020-01-01', 'Đã có kết quả', award
            row[3] = '02/10/2014'
            row[0] = str(len(rows) + 1)
            rows.append(row)
        service = build.return_value
        service.spreadsheets().get().execute.return_value = {'sheets': [{'properties': {
            'sheetId': 8, 'title': 'AYSBC', 'gridProperties': {'columnCount': 56}}}]}
        reads = [{'values': [headers]}, {'values': [PROFILE_EXPORT_HEADERS]}, {'values': rows}]
        def read_values(**kwargs):
            from unittest.mock import MagicMock
            response = MagicMock()
            if reads:
                response.execute.return_value = reads.pop(0)
            else:
                writes = service.spreadsheets().values().batchUpdate.call_args.kwargs['body']['data']
                response.execute.return_value = {'values': [update['values'][0] for update in writes]}
            return response
        service.spreadsheets().values().get.side_effect = read_values
        result = export_session_to_google_sheet(sheet, validate_template=True)
        self.assertEqual(result['updated'], 2)
        self.assertEqual(result['exported'], 0)
        writes = service.spreadsheets().values().batchUpdate.call_args.kwargs['body']['data']
        self.assertEqual([item['range'] for item in writes], ["'AYSBC'!A3:BD3", "'AYSBC'!A4:BD4"])
        after = [item['values'][0] for item in writes]
        self.assertEqual([row[15] for row in after], ['Botany', 'Mathematics'])
        self.assertEqual([row[34] for row in after], ['Gold', ''])
        self.assertEqual([row[3] for row in after], ['02/10/2014', '02/10/2014'])
        self.assertEqual([row[51:53] for row in after], [['Vòng 1 – Vòng loại Quốc gia', 'Gold'], ['', '']])
        self.assertTrue(all(row[1] == self.candidate.code and len(row) == 56 and row[54] == row[55] for row in after))
        service.spreadsheets().values().clear.assert_not_called()
        requests = service.spreadsheets().batchUpdate.call_args.kwargs['body']['requests']
        self.assertTrue(all(item['repeatCell']['range']['endColumnIndex'] <= 56 for item in requests))

    def test_form_recovers_new_session_profile_and_preserves_it_on_reimport(self):
        from .form_registration import import_form_rows
        for code in ('FIMO', 'FIEO'):
            ExamSession.objects.get_or_create(id=code.lower() + '-2026-2027', defaults={
                'competition_id': code, 'code': code, 'name': code, 'parent': 'FT',
                'organizer': 'FT', 'time': '2026', 'sort_key': code})
        # This is a returning profile with no membership in the new period.
        CandidateParticipation.objects.filter(candidate=self.candidate).delete()
        self.candidate.school = 'Old school'
        self.candidate.grade = '5'
        self.candidate.save()
        row = [''] * 15
        row[0], row[2], row[3] = '07/10/2026 10:00', self.candidate.name, '01/01/2015'
        row[4], row[5], row[9] = '22215012671', 'parent@example.test', '0986096894/0973213868'
        row[10], row[11], row[12] = 'New school', 'Khối 6 - 6T4', 'FIMO'
        result = import_form_rows('FIMO, FIEO', [{'rowNumber': 2, 'values': row}])
        self.assertEqual(result['created'], 0)
        self.candidate.refresh_from_db()
        self.assertEqual((self.candidate.school, self.candidate.grade, self.candidate.class_name), ('New school', '6', '6T4'))
        self.assertEqual(self.candidate.phone, '0986096894 / 0973213868')
        self.candidate.school = 'Corrected on web'
        self.candidate.save()
        import_form_rows('FIMO, FIEO', [{'rowNumber': 2, 'values': row}])
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.school, 'Corrected on web')

        # A later period with a new grade cannot inherit last year's class.
        CandidateParticipation.objects.filter(candidate=self.candidate, session_id='fimo-2026-2027').delete()
        row[11] = 'Khối 7'
        import_form_rows('FIMO, FIEO', [{'rowNumber': 2, 'values': row}])
        self.candidate.refresh_from_db()
        self.assertEqual((self.candidate.grade, self.candidate.class_name), ('7', ''))

    @patch('examination.management.commands.restore_session_sheet_history.build_sheets_service')
    def test_historical_link_is_created_only_after_missing_results_are_recovered(self, build):
        from django.core.management import call_command
        from io import StringIO
        self.session.code, self.session.phase = 'SIAIO', 'Hoàn thành'
        self.session.save()
        row = session_export_rows(self.session.pk)[2]
        row[1], row[23], row[30], row[31], row[34] = '', '01/01/2020', 'Đã có kết quả', '135/150', 'Vàng'
        service = build.return_value
        service.spreadsheets().get().execute.return_value = {'sheets': [{'properties': {
            'title': 'SCO - IAIO', 'gridProperties': {'columnCount': 70}}}]}
        service.spreadsheets().values().get().execute.return_value = {'values': [EXPORT_HEADERS, row]}
        call_command('restore_session_sheet_history', sessions=self.session.pk, stdout=StringIO())
        self.assertEqual(RoundResult.objects.count(), 0)
        self.assertFalse(ExaminationSheet.objects.filter(session_id=self.session.pk).exists())
        call_command('restore_session_sheet_history', sessions=self.session.pk, apply=True, stdout=StringIO())
        result = RoundResult.objects.get()
        self.assertEqual((result.score, result.result, result.exam_date), ('135/150', 'Vàng', '2020-01-01'))
        self.assertEqual(ExaminationSheet.objects.get(session_id=self.session.pk).stage, 'session-output')
        self.assertEqual(session_export_rows(self.session.pk)[2][66:68], ['Vòng 1 – Vòng loại Quốc gia', 'Vàng'])

    def test_history_recovery_flags_a_conflicting_award_and_preserves_existing_result(self):
        from .management.commands.restore_session_sheet_history import missing_history
        RoundResult.objects.create(participation=self.participation, round_id='qualifying',
            round_name='Vòng loại Quốc gia', result='Bạc')
        row = session_export_rows(self.session.pk)[2]
        row[34] = 'Vàng'
        row[21] = 'Đủ điều kiện tham gia Vòng Quốc tế'
        _, rounds, conflicts = missing_history(self.participation, row)
        self.assertIn({'round': 1, 'field': 'result'}, conflicts)
        self.assertNotIn({'round': 1, 'field': 'eligibility'}, conflicts)
        self.assertEqual(RoundResult.objects.get().result, 'Bạc')

    def test_history_profile_recovery_only_fills_valid_missing_stable_fields(self):
        from .management.commands.restore_session_sheet_history import missing_profile
        self.candidate.nationality, self.candidate.email = '', '.'
        row = session_export_rows(self.session.pk)[2]
        row[5], row[8], row[12], row[13] = 'Việt Nam', 'parent@example.com', 'Old school', 'Old class'
        self.assertEqual(missing_profile(self.candidate, row), {'nationality': 'Việt Nam', 'email': 'parent@example.com'})
        self.candidate.email = 'new@example.com'
        self.assertNotIn('email', missing_profile(self.candidate, row))
        self.candidate.email, row[8] = '', 'not an email'
        self.assertNotIn('email', missing_profile(self.candidate, row))

    def test_historical_export_keeps_disputed_birth_date_and_identifiers(self):
        from .sync import _project_session_sheet_row, SUMMARY_EXPORT_HEADERS
        row = session_export_rows(self.session.pk)[2]
        row[3], row[4] = '10/02/2014', '001314066746'
        before = list(row)
        before[3], before[4] = '02/10/2014', '001314000001'
        projected = _project_session_sheet_row(row, before, EXPORT_HEADERS[:51] + SUMMARY_EXPORT_HEADERS, self.session)
        self.assertEqual(projected[3:5], ['02/10/2014', '001314000001'])

    def test_placeholder_profile_values_cannot_be_reintroduced_by_reimport(self):
        self.candidate.ward, self.candidate.address, self.candidate.parent = '.', '—', 'N/A'
        self.candidate.save()
        self.candidate.refresh_from_db()
        self.assertEqual((self.candidate.ward, self.candidate.address, self.candidate.parent), ('', '', ''))
        from .form_registration import clean
        self.assertEqual(clean('.'), '')
        self.assertEqual(clean('P. Thanh Xuân'), 'P. Thanh Xuân')

    def test_export_does_not_fill_missing_child_identifier_from_shared_household_id(self):
        from .sync import _project_session_sheet_row, SUMMARY_EXPORT_HEADERS
        Candidate.objects.create(id='sibling', code='FT-90001', name='Nguyễn Bình',
            identity=self.candidate.identity, sort_key='2')
        row = session_export_rows(self.session.pk)[2]
        before = list(row)
        before[4] = ''
        projected = _project_session_sheet_row(row, before, EXPORT_HEADERS[:51] + SUMMARY_EXPORT_HEADERS, self.session)
        self.assertEqual(projected[4], '')


class SheetRoundMatchingTests(TestCase):
    """Regression: SCO - SIAIO lost Lương Hữu Hòa's score (09/10/2026)."""

    def setUp(self):
        self.session = ExamSession.objects.create(id='siaio-test', competition_id='SIAIO', code='SIAIO',
            name='SIAIO', parent='SCO', organizer='SCO', time='2026-2027', sort_key='1',
            rounds=[{'id': 'round-national', 'name': 'Vòng loại Quốc gia', 'date': '2026-10-04',
                     'slots': [{'id': 'day-round-national', 'date': '2026-10-04'}]}])
        self.candidate = Candidate.objects.create(id='FT-00332', code='FT-00332', name='Lương Hữu Hòa', sort_key='1')
        participation = CandidateParticipation.objects.create(candidate=self.candidate, session=self.session)
        # Registered before the slot was known: blank occurrence.
        self.original = RoundResult.objects.create(participation=participation, round_id='round-national',
            round_name='Vòng loại Quốc gia', occurrence_id='', exam_date='2026-10-04')

    def test_sheet_upper_case_round_fills_the_existing_result(self):
        from .sync import upsert_participation_history
        upsert_participation_history(self.candidate, self.session.pk, [{
            'round': 'VÒNG LOẠI QUỐC GIA', 'date': '04/10/2026', 'time': '9:00-12:00',
            'attendance': 'Đã dự thi', 'score': '49'}], 'sheet')
        results = RoundResult.objects.filter(participation__candidate=self.candidate)
        self.assertEqual(results.count(), 1)
        self.original.refresh_from_db()
        self.assertEqual((self.original.round_name, self.original.score, self.original.time_slot),
                         ('Vòng loại Quốc gia', '49', '9:00-12:00'))


class SessionIsolationTests(TestCase):
    """Regression (09/10/2026): IMO/ISO/AYSBC history appeared in FIMO/FIEO 2026-2027."""

    def setUp(self):
        from authentication.models import UserProfile
        from rest_framework.test import APIClient
        self.old = ExamSession.objects.create(id='imo-old', competition_id='IMO', code='IMO', name='IMO 2026',
            parent='SCO', organizer='SCO', time='2025-2026', sort_key='1',
            rounds=[{'id': 'round-national', 'name': 'Vòng loại Quốc gia'}])
        self.new = ExamSession.objects.create(id='fimo-new', competition_id='FIMO', code='FIMO', name='FIMO 2026-2027',
            parent='FT', organizer='FT', time='2026-2027', sort_key='2',
            rounds=[{'id': 'round-national', 'name': 'Vòng loại Quốc gia'}, {'id': 'round-final', 'name': 'Chung kết'}])
        self.candidate = Candidate.objects.create(id='FT-00104', code='FT-00104', name='Nguyễn Hà An',
            identity='001314007465', grade='Khối 6', class_name='7S', sort_key='1')
        old_part = CandidateParticipation.objects.create(candidate=self.candidate, session=self.old)
        RoundResult.objects.create(participation=old_part, round_id='round-national', round_name='Vòng loại Quốc gia',
            exam_date='2026-05-17', sbd='IMO-IEO-067', score='34/50')
        self.client = APIClient()
        self.client.force_authenticate(UserProfile.objects.create(email='staff@example.test', role='ADMIN'))

    def test_adding_a_repository_candidate_copies_no_other_session_rounds(self):
        history = [{'sessionId': 'imo-old', 'roundId': 'round-national', 'round': 'Vòng loại Quốc gia',
                    'date': '2026-05-17', 'sbd': 'IMO-IEO-067', 'score': '34/50'},
                   {'roundId': 'aysbc-regional', 'round': 'Vòng 2', 'score': '74'}]
        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.new.pk, 'source': 'Thêm thí sinh từ kho',
            'records': [{'code': 'FT-00104', 'name': 'Nguyễn Hà An', 'identity': '001314007465', 'examHistory': history}],
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        new_results = RoundResult.objects.filter(participation__session=self.new)
        self.assertFalse(new_results.exclude(sbd='', score='').exists())
        self.assertFalse(new_results.filter(round_id='aysbc-regional').exists())

    def test_grade_follows_class_and_is_a_bare_number(self):
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.grade, '7')

    def test_first_round_admits_registrants_without_writing_eligibility(self):
        from .eligibility import eligible_for_round_q
        part = CandidateParticipation.objects.create(candidate=self.candidate, session=self.new)
        first = RoundResult.objects.create(participation=part, round_id='round-national', round_name='Vòng loại Quốc gia')
        later = RoundResult.objects.create(participation=part, round_id='round-final', round_name='Chung kết')
        self.assertEqual(first.eligibility, '')
        self.assertTrue(RoundResult.objects.filter(pk=first.pk).filter(eligible_for_round_q(self.new, 'round-national')).exists())
        self.assertFalse(RoundResult.objects.filter(pk=later.pk).filter(eligible_for_round_q(self.new, 'round-final')).exists())


class RemovedRegistrationRowTests(TestCase):
    """Regression (09/10/2026): Phú La pupils removed from FIMO stayed on FT - FIMO."""

    def setUp(self):
        self.session = ExamSession.objects.create(id='fimo-rm', competition_id='FIMO', code='FIMO', name='FIMO',
            parent='FT', organizer='FT', time='2026-2027', sort_key='1', rounds=[{'id': 'round-national', 'name': 'Vòng loại'}])
        self.sheet = ExaminationSheet.objects.create(id='fimo-rm-sheet', name='FT - FIMO', session_id=self.session.pk,
            url='https://docs.google.com/spreadsheets/d/x/edit', sheet_tab='FT - FIMO', stage='session-output',
            created_at=timezone.now(), updated_at=timezone.now())
        self.kept = Candidate.objects.create(id='FT-1', code='FT-1', name='Ở lại', sort_key='1')
        self.gone = Candidate.objects.create(id='FT-2', code='FT-2', name='Bị gỡ', sort_key='2')
        CandidateParticipation.objects.create(candidate=self.kept, session=self.session)
        CandidateParticipation.objects.create(candidate=self.gone, session=self.session).delete()

    def test_queue_deletes_rows_of_removed_candidates_only(self):
        from .models import SessionSheetOutbox
        from .session_sheet_queue import drain_session_sheet_queue
        self.assertTrue(SessionSheetOutbox.objects.filter(candidate_id='FT-2').exists())
        with patch('examination.session_sheet_queue.remove_session_sheet_rows', return_value=1) as remove, \
             patch('examination.session_sheet_queue.export_session_to_google_sheet', return_value={'success': True, 'exported': 0, 'updated': 0}) as export:
            drain_session_sheet_queue()
        self.assertEqual(remove.call_args.args[1], ['FT-2'])
        self.assertNotIn('FT-2', export.call_args.kwargs['append_candidate_codes'])
        self.assertFalse(SessionSheetOutbox.objects.exists())

    def test_row_deletion_matches_the_ft_code_and_deletes_bottom_up(self):
        from unittest.mock import MagicMock
        from .sync import remove_session_sheet_rows
        service = MagicMock()
        service.spreadsheets.return_value.values.return_value.get.return_value.execute.return_value = {
            'values': [['1', 'FT-1'], ['2', 'FT-2'], ['3', 'FT-3'], ['4', 'ft-2']]}
        with patch('examination.sync.build_sheets_service', return_value=service), \
             patch('examination.sync._output_sheet_target', return_value={'title': 'FT - FIMO', 'sheetId': 7}):
            self.assertEqual(remove_session_sheet_rows(self.sheet, ['FT-2']), 2)
        requests = service.spreadsheets.return_value.batchUpdate.call_args.kwargs['body']['requests']
        self.assertEqual([r['deleteDimension']['range']['startIndex'] for r in requests], [5, 3])


class ShiftRoomCompatibilityTests(TestCase):
    """FIMO 11/10/2026: two shifts on one day, rooms written as 'Room N: meet…'."""

    def setUp(self):
        from .models import ExamRoom
        self.session = ExamSession.objects.create(id='fimo-ca', competition_id='FIMO', code='FIMO', name='FIMO',
            parent='FT', organizer='FT', time='2026-2027', sort_key='1',
            rounds=[{'id': 'round-national', 'name': 'Vòng loại Quốc gia', 'slots': [
                {'id': 'day-1', 'date': '2026-10-11', 'time': '09:00-10:00', 'label': 'Ca 1'},
                {'id': 'day-1-ca-2', 'date': '2026-10-11', 'time': '10:30-11:30', 'label': 'Ca 2'},
                {'id': 'day-2', 'date': '2026-12-06'}]}])
        self.rooms = {}
        for occurrence in ('day-1', 'day-1-ca-2'):
            for number in (1, 2):
                self.rooms[(occurrence, number)] = ExamRoom.objects.create(session=self.session, round_id='round-national',
                    occurrence_id=occurrence, round_name='Vòng loại Quốc gia', common_name='Room', room_number=str(number),
                    label=f'Room {number}', mode=ExamRoom.MODE_ONLINE, link=f'https://meet.google.com/room-{number}')
        self.candidate = Candidate.objects.create(id='FT-CA', code='FT-CA', name='Thí sinh ca', sort_key='1')
        participation = CandidateParticipation.objects.create(candidate=self.candidate, session=self.session)
        self.result = RoundResult.objects.create(participation=participation, round_id='round-national', round_name='Vòng loại Quốc gia')

    def sheet(self, time, room):
        from .sync import upsert_participation_history
        upsert_participation_history(self.candidate, self.session.pk, [{
            'round': 'VÒNG LOẠI QUỐC GIA', 'date': '11/10/2026', 'time': time, 'mode': 'Trực tuyến',
            'location': f'Room {room}: meet.google.com/room-{room}'}], 'sheet')
        self.result.refresh_from_db()

    def test_room_cell_parses_label_and_link(self):
        from .views import sheet_room_details
        details = sheet_room_details('Room 4: meet.google.com/bhi-ofgf-yia', 'Trực tuyến')
        self.assertEqual((details['label'], details['link']), ('Room 4', 'https://meet.google.com/bhi-ofgf-yia'))

    def test_time_picks_the_shift_and_the_existing_room(self):
        from .models import ExamRoom
        self.sheet('10:30-11:30', 2)
        self.assertEqual(self.result.occurrence_id, 'day-1-ca-2')
        self.assertEqual(self.result.exam_room, self.rooms[('day-1-ca-2', 2)])
        self.assertEqual(ExamRoom.objects.filter(session=self.session).count(), 4)

    def test_room_change_on_the_sheet_moves_the_candidate(self):
        self.sheet('9:00-10:00', 1)
        self.assertEqual(self.result.exam_room, self.rooms[('day-1', 1)])
        self.sheet('9:00-10:00', 2)
        self.assertEqual(self.result.exam_room, self.rooms[('day-1', 2)])

    def manager(self):
        from rest_framework.test import APIClient
        from authentication.models import UserProfile
        client = APIClient()
        client.force_authenticate(UserProfile.objects.get_or_create(email='room-entry@example.test', defaults={'role': 'ADMIN'})[0])
        return client

    def test_room_options_list_count_time_and_invigilators(self):
        from datetime import datetime, timezone as tz
        from authentication.models import UserProfile
        from .models import ExamInvigilationShift
        self.sheet('9:00-10:00', 1)
        staff = UserProfile.objects.create(email='gt@example.test', name='Giám thị A', role='EMPLOYEE')
        shift = ExamInvigilationShift.objects.create(session=self.session, exam_room=self.rooms[('day-1', 1)], occurrence_id='day-1',
            round_name='Vòng loại Quốc gia', label='Room 1', room_number='1', starts_at=datetime(2026, 10, 11, 2, tzinfo=tz.utc),
            ends_at=datetime(2026, 10, 11, 3, tzinfo=tz.utc))
        shift.invigilators.add(staff)
        data = self.manager().get(f'/api/examination/sessions/{self.session.pk}/room-options').data
        room = next(item for item in data['rooms'] if item['label'] == 'Room 1' and item['occurrenceId'] == 'day-1')
        self.assertEqual((room['assignedCount'], room['time'], room['invigilators']), (1, '9:00-10:00', ['Giám thị A']))
        self.assertEqual(len(data['rooms']), 4)

    def test_new_candidate_joins_the_chosen_room_like_its_neighbours(self):
        self.sheet('10:30-11:30', 2)
        response = self.manager().post('/api/examination/import/candidates', {
            'sessionIds': [self.session.pk], 'source': 'Nhập thủ công', 'records': [{'name': 'Thí sinh mới'}],
            'examRooms': {self.session.pk: {'roomId': str(self.rooms[('day-1-ca-2', 2)].id)}}}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        result = RoundResult.objects.get(participation__candidate__name='Thí Sinh Mới')
        self.assertEqual((result.occurrence_id, result.exam_room, result.round_name), ('day-1-ca-2', self.rooms[('day-1-ca-2', 2)], 'Vòng loại Quốc gia'))
        self.assertEqual(response.data['items'][0]['participations'][0]['rounds'][0]['roomName'], 'Room 2')
        self.assertEqual((result.exam_date, result.time_slot, result.mode, result.location),
                         (self.result.exam_date, '10:30-11:30', 'Trực tuyến', 'Room 2: meet.google.com/room-2'))

    def test_new_room_can_be_created_for_a_new_candidate(self):
        from .models import ExamRoom
        response = self.manager().post('/api/examination/import/candidates', {
            'sessionIds': [self.session.pk], 'source': 'Nhập thủ công', 'records': [{'name': 'Thí sinh phòng mới'}],
            'examRooms': {self.session.pk: {'newRoom': {'occurrenceId': 'day-1', 'label': 'Room 5', 'link': 'meet.google.com/new-room'}}}}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        room = ExamRoom.objects.get(session=self.session, occurrence_id='day-1', label='Room 5')
        result = RoundResult.objects.get(participation__candidate__name='Thí Sinh Phòng Mới')
        self.assertEqual((result.exam_room, result.time_slot, result.location), (room, '09:00-10:00', 'Room 5: https://meet.google.com/new-room'))
        duplicate = self.manager().post('/api/examination/import/candidates', {
            'sessionIds': [self.session.pk], 'source': 'Nhập thủ công', 'records': [{'name': 'Người khác'}],
            'examRooms': {self.session.pk: {'newRoom': {'occurrenceId': 'day-1', 'label': 'Room 1'}}}}, format='json')
        self.assertEqual(duplicate.status_code, 500)
        self.assertFalse(Candidate.objects.filter(name='Người Khác').exists())
