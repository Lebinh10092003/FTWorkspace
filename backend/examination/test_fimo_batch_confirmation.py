from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Candidate, CandidateParticipation, ExamSession, ExaminationSheet, LogNote, RoundResult, SessionSheetOutbox
from .sync import session_export_rows


class FimoBatchConfirmationTests(TestCase):
    url = '/api/examination/fimo/batch-2/confirmation'
    secret = 'test-only-fimo-webhook-secret-at-least-32-characters'

    def setUp(self):
        self.client = APIClient()
        keys = patch.dict('os.environ', {'FIMO_BATCH_2_WEBHOOK_SECRET': self.secret})
        keys.start()
        self.addCleanup(keys.stop)
        self.session, _ = ExamSession.objects.update_or_create(pk='fimo-2026-2027', defaults={
            'code': 'FIMO',
            'rounds': [{'id': 'round-national', 'name': 'Vòng loại Quốc gia', 'slots': [
                {'id': 'd1', 'date': '2026-10-11'}, {'id': 'd2', 'date': '2026-12-06'},
                {'id': 'd3', 'date': '2027-02-28'},
            ]}],
        })
        self.candidate = Candidate.objects.create(id='FT-90123', code='FT-90123', name='Thí sinh thử nghiệm')
        self.participation = CandidateParticipation.objects.create(candidate=self.candidate, session=self.session)
        self.original = RoundResult.objects.create(
            participation=self.participation, round_id='round-national', round_name='Vòng loại Quốc gia',
            occurrence_id='d1', exam_date='2026-10-11', score='110', rank='Bạc', sbd='FIMO001',
        )

    def confirm(self, code='FT-90123'):
        return self.client.post(self.url, {'candidateCode': code}, format='json',
                                HTTP_X_EXAMINATION_WEBHOOK_SECRET=self.secret)

    def test_click_creates_only_batch_two_and_enqueues_roster_export(self):
        now = timezone.now()
        ExaminationSheet.objects.create(id='fimo-output', session_id=self.session.pk, sheet_tab='FT - FIMO',
                                        stage='session-output', url='https://docs.google.com/spreadsheets/d/test/edit',
                                        created_at=now, updated_at=now)
        SessionSheetOutbox.objects.filter(candidate_id=self.candidate.pk, session_id=self.session.pk).delete()
        original = RoundResult.objects.filter(pk=self.original.pk).values().get()

        self.assertEqual(self.confirm().data, {'status': 'added'})
        self.assertEqual(self.confirm().data, {'status': 'already_assigned'})
        self.assertEqual(RoundResult.objects.filter(pk=self.original.pk).values().get(), original)
        second = self.participation.round_results.get(exam_date='2026-12-06')
        self.assertEqual((second.round_id, second.occurrence_id, second.sbd, second.score), ('round-national', '', '', ''))
        self.assertEqual(self.participation.round_results.count(), 2)
        self.assertTrue(SessionSheetOutbox.objects.filter(candidate_id=self.candidate.pk, session_id=self.session.pk).exists())
        self.assertEqual(LogNote.objects.filter(entity_key='candidate-FT-90123', system=True).count(), 1)
        groups, headers, row = session_export_rows(self.session.pk)
        first_column = groups.index('VÒNG 1 · ĐỢT 1 (11/10/2026)')
        second_column = groups.index('VÒNG 1 · ĐỢT 2 (06/12/2026)')
        self.assertEqual(row[headers.index('Điểm', first_column)], '110')
        self.assertEqual(row[headers.index('Ngày thi', second_column)], '06/12/2026')

    def test_preexisting_batch_with_assigned_slot_is_recognized_even_without_exam_date(self):
        self.participation.round_results.create(round_id='round-national', round_name='Vòng loại Quốc gia', occurrence_id='d2')
        self.assertEqual(self.confirm().data, {'status': 'already_assigned'})
        self.assertEqual(self.participation.round_results.count(), 2)

    def test_authentication_and_exact_session_membership(self):
        other_session = ExamSession.objects.create(id='test-fieo', code='FIEO')
        other_candidate = Candidate.objects.create(id='FT-90124', code='FT-90124', name='Thí sinh FIEO')
        CandidateParticipation.objects.create(candidate=other_candidate, session=other_session)
        self.assertEqual(self.client.post(self.url, {'candidateCode': self.candidate.code}, format='json').status_code, 403)
        self.assertEqual(self.confirm('FT-9012x').status_code, 400)
        self.assertEqual(self.confirm(other_candidate.code).status_code, 404)
        self.assertEqual(self.participation.round_results.count(), 1)

    def test_changed_schedule_never_redirects_existing_invitation_to_another_batch(self):
        self.session.rounds[0]['slots'][1]['date'] = '2026-12-13'
        self.session.save(update_fields=['rounds'])
        self.assertEqual(self.confirm().status_code, 409)
        self.assertEqual(self.participation.round_results.count(), 1)
