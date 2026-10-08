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
        row[0] = '8'
        current = list(row)
        current[1] = ' '
        current[4] = ''
        unrelated = ['9', 'UNKNOWN', 'Other person']
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
