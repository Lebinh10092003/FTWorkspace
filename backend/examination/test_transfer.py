"""Đổi cuộc thi (FIMO -> FIEO), tab "Cập nhật" 10/10/2026."""
from django.test import TestCase
from rest_framework.test import APIClient

from authentication.models import SystemConfig, UserProfile
from .models import (Candidate, CandidateParticipation, ExamRoom, ExamSession, ExaminationBillingRecord,
                     RoundResult, SessionSheetOutbox)
from .school_import import attach_to_school, refresh_group_billing


class TransferSessionTests(TestCase):
    def setUp(self):
        SystemConfig.objects.update_or_create(key='examination_partners', defaults={'data': {'partners': [
            {'id': 'pl', 'school': 'Trường THCS Phú La', 'representative': 'A', 'phone': '0900000000', 'email': 'pl@example.test'}]}})
        rounds = [{'id': 'round-national', 'name': 'Vòng loại Quốc gia', 'slots': [{'id': 'day-1', 'date': '2026-10-11', 'time': '10:30-11:30'}]}]
        self.fimo = ExamSession.objects.create(id='fimo-t', competition_id='FIMO', code='FIMO', name='FIMO', parent='FT', organizer='FT', time='2026-2027', sort_key='1', rounds=rounds)
        self.fieo = ExamSession.objects.create(id='fieo-t', competition_id='FIEO', code='FIEO', name='FIEO', parent='FT', organizer='FT', time='2026-2027', sort_key='2', rounds=rounds)
        self.client = APIClient()
        self.client.force_authenticate(UserProfile.objects.create(email='transfer@example.test', role='ADMIN'))
        partner = {'id': 'pl', 'school': 'Trường THCS Phú La'}
        self.pupils = []
        for index, name in enumerate(['Đỗ Minh Triết', 'Bạn Cùng Trường']):
            candidate = Candidate.objects.create(id=f'FT-T{index}', code=f'FT-T{index}', name=name, contests='FIMO', session_ids=['fimo-t'], sort_key=str(index))
            participation = CandidateParticipation.objects.create(candidate=candidate, session=self.fimo, subject='Toán')
            attach_to_school(participation, partner, 250000)
            self.pupils.append(candidate)
        self.fimo_group = CandidateParticipation.objects.get(candidate=self.pupils[0]).school_registration
        refresh_group_billing(self.fimo_group)
        room = ExamRoom.objects.create(session=self.fimo, round_id='round-national', occurrence_id='day-1', round_name='Vòng loại Quốc gia',
            common_name='Room', room_number='3', label='Room 3', mode=ExamRoom.MODE_ONLINE, link='https://meet.google.com/x')
        RoundResult.objects.create(participation=CandidateParticipation.objects.get(candidate=self.pupils[0]), round_id='round-national',
            round_name='Vòng loại Quốc gia', occurrence_id='day-1', exam_room=room, sbd='140104', time_slot='10:30-11:30')
        from django.utils import timezone
        from .models import ExaminationSheet
        for session in (self.fimo, self.fieo):
            ExaminationSheet.objects.create(id=f'sheet-{session.pk}', name=session.code, url='https://docs.google.com/spreadsheets/d/x/edit',
                sheet_tab=f'FT - {session.code}', session_id=session.pk, stage='session-output', created_at=timezone.now(), updated_at=timezone.now())
        SessionSheetOutbox.objects.all().delete()

    def transfer(self, code='FT-T0', **extra):
        return self.client.post(f'/api/examination/candidates/{code}/sessions/fimo-t/transfer', {'targetSessionId': 'fieo-t', **extra}, format='json')

    def test_school_registration_fee_and_sheets_follow_without_old_results(self):
        response = self.transfer()
        self.assertEqual(response.status_code, 200, response.data)
        moved = CandidateParticipation.objects.get(candidate=self.pupils[0])
        self.assertEqual(moved.session_id, 'fieo-t')
        self.assertEqual((moved.school_registration.school, moved.registration_data['schoolFee'], moved.subject), ('Trường THCS Phú La', 250000, ''))
        self.assertFalse(RoundResult.objects.filter(participation__candidate=self.pupils[0], sbd='140104').exists())
        self.assertEqual(ExaminationBillingRecord.objects.get(school_registration=self.fimo_group).amount, 250000)
        self.assertEqual(ExaminationBillingRecord.objects.get(school_registration=moved.school_registration).amount, 250000)
        self.pupils[0].refresh_from_db()
        self.assertEqual((self.pupils[0].session_ids, self.pupils[0].contests), (['fieo-t'], 'FIEO'))
        self.assertEqual(set(SessionSheetOutbox.objects.filter(candidate_id='FT-T0').values_list('session_id', flat=True)), {'fimo-t', 'fieo-t'})
        self.assertIn('Đổi cuộc thi', response.data['message'])

    def test_room_can_be_chosen_in_the_new_contest(self):
        room = ExamRoom.objects.create(session=self.fieo, round_id='round-national', occurrence_id='day-1', round_name='Vòng loại Quốc gia',
            common_name='Room', room_number='1', label='Room 1', mode=ExamRoom.MODE_ONLINE, link='https://meet.google.com/y')
        self.assertEqual(self.transfer(examRoom={'roomId': str(room.id)}).status_code, 200)
        result = RoundResult.objects.get(participation__candidate=self.pupils[0])
        self.assertEqual((result.exam_room, result.location), (room, 'Room 1: https://meet.google.com/y'))

    def test_already_registered_or_same_contest_is_refused(self):
        CandidateParticipation.objects.create(candidate=self.pupils[0], session=self.fieo)
        response = self.transfer()
        self.assertEqual(response.status_code, 400)
        self.assertIn('Gỡ khỏi kỳ thi', response.data['error'])
        self.assertTrue(CandidateParticipation.objects.filter(candidate=self.pupils[0], session=self.fimo).exists())

    def test_paid_individual_registration_takes_its_bill_along(self):
        candidate = Candidate.objects.create(id='FT-P', code='FT-P', name='Cá Nhân', session_ids=['fimo-t'], sort_key='9')
        participation = CandidateParticipation.objects.create(candidate=candidate, session=self.fimo)
        ExaminationBillingRecord.objects.update_or_create(participation=participation, defaults={'amount': 300000, 'transfer_status': 'confirmed'})
        self.assertEqual(self.transfer('FT-P').status_code, 200)
        self.assertEqual(ExaminationBillingRecord.objects.get(amount=300000).participation.session_id, 'fieo-t')

    def test_removing_a_pupil_lowers_the_school_total(self):
        response = self.client.delete('/api/examination/candidates/FT-T1/sessions/fimo-t')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(ExaminationBillingRecord.objects.get(school_registration=self.fimo_group).amount, 250000)
