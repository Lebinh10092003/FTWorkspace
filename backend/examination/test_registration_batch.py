from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from .form_registration import SESSION_IDS, SPREADSHEET_ID
from .models import Candidate, CandidateParticipation, ExamSession, RoundResult
from .registration_batch import add_batch, open_batch, place_new_registration, registered_on


def three_batches(today):
    """Vòng loại 3 đợt: đợt 1 đã qua hạn, đợt 2 đang mở, đợt 3 sau đó."""
    day = lambda offset: (today + timedelta(days=offset)).isoformat()
    return [{'id': 'qualifying', 'name': 'Vòng loại', 'date': '', 'fee': 250000, 'slots': [
        {'id': 'b1', 'date': day(-3), 'time': '08:00', 'registrationDeadline': day(-10)},
        {'id': 'b2', 'date': day(20), 'time': '08:00', 'link': 'https://example.test/b2', 'registrationDeadline': day(13)},
        {'id': 'b3', 'date': day(60), 'registrationDeadline': day(53)},
    ]}, {'id': 'national', 'name': 'Chung kết', 'date': day(120), 'slots': []}]


class RegistrationBatchTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        for code, rounds in (('FIMO', three_batches(self.today)), ('FIEO', [])):
            ExamSession.objects.update_or_create(id=SESSION_IDS[code], defaults=dict(
                competition_id=code.lower(), code=code, name=code, parent=code, organizer='Test',
                time='2026–2027', sort_key=code, phase='Vòng loại', rounds=rounds))
        self.session = ExamSession.objects.get(pk=SESSION_IDS['FIMO'])

    def candidate(self, name='Trần Thị Thử'):
        code = f'FT-{Candidate.objects.count() + 1:05d}'
        return Candidate.objects.create(id=code, code=code, name=name)

    def test_open_batch_is_the_one_the_form_offers(self):
        entry, number, day = open_batch(self.session, self.today)
        self.assertEqual((entry['id'], number, day), ('qualifying', 2, self.today + timedelta(days=20)))
        self.assertEqual(open_batch(self.session, self.today + timedelta(days=30))[1], 3)
        self.assertIsNone(open_batch(self.session, self.today + timedelta(days=90)), 'every batch closed')

    def test_multi_batch_round_uses_batch_deadlines_instead_of_round_deadline(self):
        self.session.rounds[0]['registrationDeadline'] = self.today.isoformat()
        self.assertEqual(open_batch(self.session, self.today)[1], 2)

    def test_backfill_uses_original_form_submission_day(self):
        participation = CandidateParticipation.objects.create(candidate=self.candidate(), session=self.session, registration_data={
            'formSubmittedAt': (self.today - timedelta(days=1)).isoformat() + 'T08:00:00+07:00',
            'registeredAt': self.today.isoformat() + 'T09:00:00+07:00',
        })
        self.assertEqual(registered_on(participation), self.today - timedelta(days=1))

    def test_form_registration_enters_open_batch_with_date_only(self):
        row = [''] * 17
        row[0], row[2], row[3], row[4], row[12] = '25/11/2026 9:00:00', 'Trần Thị Thử', '01/01/2017', '001201099999', 'FIMO'
        with patch.dict('os.environ', {'EXAMINATION_REGISTRATION_WEBHOOK_SECRET': 'test-secret'}):
            response = self.client.post('/api/examination/form-registration/webhook', {
                'spreadsheetId': SPREADSHEET_ID, 'sheetTab': 'FIMO, FIEO', 'rows': [{'rowNumber': 2, 'values': row}],
            }, content_type='application/json', HTTP_X_EXAMINATION_WEBHOOK_SECRET='test-secret')
        self.assertEqual(response.json()['created'], 1, response.json())
        result = RoundResult.objects.get()
        self.assertEqual((result.round_id, result.round_name, result.occurrence_id, result.exam_date),
                         ('qualifying', 'Vòng loại', 'b2', (self.today + timedelta(days=20)).isoformat()))
        # Phòng, giờ/ca, hình thức và link vẫn chờ Khảo thí xếp.
        self.assertEqual((result.time_slot, result.link, result.room_name, result.mode), ('', '', '', ''))

    def test_existing_placement_is_kept(self):
        participation = CandidateParticipation.objects.create(candidate=self.candidate(), session=self.session)
        RoundResult.objects.create(participation=participation, round_id='qualifying', round_name='Vòng loại',
                                   occurrence_id='b3', exam_date='2027-01-01')
        self.assertIsNone(place_new_registration(participation, self.today))
        self.assertEqual(list(RoundResult.objects.values_list('occurrence_id', flat=True)), ['b3'])

    def test_blank_round_result_is_filled_instead_of_duplicated(self):
        participation = CandidateParticipation.objects.create(candidate=self.candidate(), session=self.session)
        RoundResult.objects.create(participation=participation, round_id='qualifying', round_name='Vòng loại')
        place_new_registration(participation, self.today)
        self.assertEqual(list(RoundResult.objects.values_list('occurrence_id', flat=True)), ['b2'])

    def sat_batch_one(self):
        candidate = self.candidate()
        candidate.identity, candidate.birth_date, candidate.email, candidate.phone = '001201099999', '2017-01-01', 'parent@example.test', '0912345678'
        candidate.save()
        participation = CandidateParticipation.objects.create(candidate=candidate, session=self.session)
        RoundResult.objects.create(participation=participation, round_id='qualifying', round_name='Vòng loại',
                                   occurrence_id='b1', exam_date=(self.today - timedelta(days=3)).isoformat(), score='120')
        return participation

    def test_public_reregistration_adds_open_batch_free(self):
        from .models import ExaminationBillingRecord
        participation = self.sat_batch_one()
        bills = ExaminationBillingRecord.objects.count()
        payload = {
            'requestKey': '00000000-0000-4000-8000-000000000001', 'contestCodes': '["FIMO"]',
            'name': 'Trần Thị Thử', 'birthDate': '2017-01-01', 'identity': '001201099999',
            'email': 'parent@example.test', 'phone': '0912345678', 'school': 'Trường A', 'grade': '3',
            'className': '3A1', 'city': 'Hà Nội', 'ward': 'Phường A', 'address': 'Số 1', 'paymentDeclared': 'true',
            'submitterEmail': 'parent@example.test',
        }
        response = self.client.post('/api/public/examination/registration', payload)
        self.assertEqual(response.status_code, 201, response.content)
        batches = dict(RoundResult.objects.filter(participation=participation).values_list('occurrence_id', 'score'))
        self.assertEqual(batches, {'b1': '120', 'b2': ''}, 'batch 1 result kept, batch 2 added')
        self.assertEqual(ExaminationBillingRecord.objects.count(), bills, 'an extra batch is free')
        participation.refresh_from_db()
        self.assertEqual(participation.registration_data['extraBatches'][0]['batch'], 2)
        again = self.client.post('/api/public/examination/registration', {**payload, 'requestKey': '00000000-0000-4000-8000-000000000002'})
        self.assertEqual(again.status_code, 409)
        self.assertIn('đợt này', again.json()['error'])

    def test_new_form_row_of_existing_candidate_adds_batch_once(self):
        participation = self.sat_batch_one()
        row = [''] * 17
        row[0], row[2], row[3], row[4], row[12] = self.today.strftime('%d/%m/%Y 09:00:00'), 'Trần Thị Thử', '01/01/2017', '001201099999', 'FIMO'
        payload = {'spreadsheetId': SPREADSHEET_ID, 'sheetTab': 'FIMO, FIEO', 'rows': [{'rowNumber': 9, 'values': row}]}
        with patch.dict('os.environ', {'EXAMINATION_REGISTRATION_WEBHOOK_SECRET': 'test-secret'}):
            for _ in range(2):
                self.client.post('/api/examination/form-registration/webhook', payload, content_type='application/json',
                                 HTTP_X_EXAMINATION_WEBHOOK_SECRET='test-secret')
        self.assertEqual(sorted(RoundResult.objects.filter(participation=participation).values_list('occurrence_id', flat=True)), ['b1', 'b2'])

    def test_staff_add_batch_and_room_seating_keep_earlier_batch(self):
        from rest_framework.test import APIClient
        from authentication.models import UserProfile
        from .models import ExamRoom
        from .room_entry import assign_to_room
        participation = self.sat_batch_one()
        client = APIClient()
        client.force_authenticate(UserProfile.objects.create(email='exam-admin@example.test', name='Admin', role='ADMIN'))
        url = f'/api/examination/candidates/{participation.candidate.code}/sessions/{self.session.id}/batches'
        response = client.post(url, {'roundId': 'qualifying', 'occurrenceId': 'b3'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(client.post(url, {'roundId': 'qualifying', 'occurrenceId': 'b3'}, format='json').status_code, 409)
        room = ExamRoom.objects.create(session=self.session, round_id='qualifying', occurrence_id='b2', round_name='Vòng loại',
                                       common_name='Phòng', room_number='1', label='Phòng 1', mode=ExamRoom.MODE_IN_PERSON)
        assign_to_room(participation, room)
        rows = {row.occurrence_id: row for row in RoundResult.objects.filter(participation=participation)}
        self.assertEqual(set(rows), {'b1', 'b2', 'b3'}, 'seating in batch 2 must keep past results and future bookings')
        self.assertEqual(rows['b1'].score, '120')
        self.assertEqual(rows['b2'].exam_room, room)
        # Phân phòng cả vòng khi chưa chọn đợt sẽ xếp một người hai ghế: bị chặn.
        blocked = client.post(f'/api/examination/sessions/{self.session.id}/rounds/qualifying/rooms', {'commonName': 'Phòng', 'rooms': []}, format='json')
        self.assertEqual(blocked.status_code, 400)
        self.assertIn('chọn đợt', blocked.json()['error'])

    def test_multiple_batches_without_assigning_an_exam_shift(self):
        entry = self.session.rounds[0]
        for slot in entry['slots'][:]:
            entry['slots'].append({**slot, 'id': f"{slot['id']}-afternoon", 'time': '14:00'})
        participant = CandidateParticipation.objects.create(candidate=self.candidate(), session=self.session)
        for offset in (20, 60):
            day = self.today + timedelta(days=offset)
            result = add_batch(participant, entry, day)
            self.assertEqual((result.occurrence_id, result.time_slot, result.exam_date), ('', '', day.isoformat()))
            self.assertIsNone(add_batch(participant, entry, day))
        self.assertEqual(participant.round_results.count(), 2)

    def test_staff_batch_operations_skip_existing_and_preserve_results(self):
        from rest_framework.test import APIClient
        from authentication.models import UserProfile

        first = self.sat_batch_one()
        second = CandidateParticipation.objects.create(candidate=self.candidate('Nguyễn Gia An'), session=self.session)
        client = APIClient()
        client.force_authenticate(UserProfile.objects.create(email='exam-admin@example.test', name='Admin', role='ADMIN'))
        bulk_url = f'/api/examination/sessions/{self.session.id}/candidate-batches'
        add_day = (self.today + timedelta(days=20)).isoformat()
        new_day = (self.today + timedelta(days=60)).isoformat()
        request = {'examDate': add_day, 'candidateCodes': [first.candidate.code, second.candidate.code, 'FT-99999']}
        response = client.post(bulk_url, request, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['candidates']), 2)
        self.assertEqual(response.data['skipped'][0]['code'], 'FT-99999')
        self.assertEqual(len(client.post(bulk_url, request, format='json').data['skipped']), 3)

        move_url = f'/api/examination/candidates/{first.candidate.code}/sessions/{self.session.id}/batches'
        result = first.round_results.get(occurrence_id='b2')
        move = {'roundId': 'qualifying', 'examDate': new_day, 'moveFromResultId': str(result.pk), 'moveFromExamDate': add_day}
        self.assertEqual(client.post(move_url, move, format='json').status_code, 200)
        self.assertEqual(client.post(move_url, move, format='json').status_code, 409)
        completed = first.round_results.get(occurrence_id='b1')
        self.assertEqual(completed.score, '120')
        self.assertEqual(client.post(move_url, {
            **move, 'examDate': add_day, 'moveFromResultId': str(completed.pk), 'moveFromExamDate': completed.exam_date,
        }, format='json').status_code, 409)
        self.assertEqual(set(first.round_results.values_list('occurrence_id', flat=True)), {'b1', 'b3'})

    def test_manual_enrollment_can_choose_batch_without_assigning_room(self):
        from rest_framework.test import APIClient
        from authentication.models import UserProfile

        client = APIClient()
        client.force_authenticate(UserProfile.objects.create(email='manual-batch@example.test', name='Admin', role='ADMIN'))
        target = (self.today + timedelta(days=60)).isoformat()
        result = client.post('/api/examination/import/candidates', {
            'sessionId': self.session.pk, 'source': 'Nhập thủ công',
            'records': [{'name': 'Nguyễn Minh An', 'birthDate': '2017-03-15'}],
            'examBatches': {self.session.pk: target},
        }, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        saved = RoundResult.objects.get(participation__candidate__name='Nguyễn Minh An', participation__session=self.session)
        self.assertEqual((saved.occurrence_id, saved.exam_date, saved.exam_room_id, saved.time_slot, saved.link),
                         ('b3', target, None, '', ''))

    def test_backfill_command_dry_runs_then_places_only_later_registrations(self):
        def registered(offset, name):
            participation = CandidateParticipation.objects.create(candidate=self.candidate(name), session=self.session)
            participation.registration_data = {'registeredAt': (self.today + timedelta(days=offset)).isoformat() + 'T09:00:00+07:00'}
            participation.save()
            return participation
        early = registered(-20, 'Đăng Ký Sớm')
        late = registered(-5, 'Đăng Ký Muộn')
        RoundResult.objects.all().delete()
        out = StringIO()
        call_command('assign_registration_batches', stdout=out)
        self.assertIn('[CHẠY THỬ] 1 thí sinh', out.getvalue())
        self.assertIn('đợt 2', out.getvalue())
        self.assertFalse(RoundResult.objects.exists(), 'dry run writes nothing')
        call_command('assign_registration_batches', '--apply', stdout=StringIO())
        self.assertEqual(RoundResult.objects.get(participation=late).occurrence_id, 'b2')
        self.assertFalse(RoundResult.objects.filter(participation=early).exists(), 'batch 1 registrants wait for Khảo thí')
        again = StringIO()
        call_command('assign_registration_batches', '--apply', stdout=again)
        self.assertIn('0 thí sinh', again.getvalue())
