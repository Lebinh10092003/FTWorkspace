from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from .form_registration import SESSION_IDS, SPREADSHEET_ID
from .models import Candidate, CandidateParticipation, ExamSession, RoundResult
from .registration_batch import open_batch, place_new_registration


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
