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
