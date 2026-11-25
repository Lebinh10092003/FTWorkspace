import datetime
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from authentication.models import UserProfile
from .form_registration import SESSION_IDS, SPREADSHEET_ID, submitted_at
from .models import Candidate, CandidateParticipation, ExamSession
from .registration_stats import daily_registration_stats


class DailyRegistrationStatsTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.sessions = {}
        for code in ('FIMO', 'FIEO'):
            self.sessions[code], _ = ExamSession.objects.update_or_create(id=SESSION_IDS[code], defaults=dict(
                competition_id=code.lower(), code=code, name=code, parent=code, organizer='Test',
                time='2026–2027', sort_key=code, phase='Tuyển sinh', rounds=[]))

    def candidate(self, code):
        return Candidate.objects.create(id=code, code=code, name=f'Thí sinh {code}')

    def at(self, days_ago, hour=9):
        value = datetime.datetime.combine(self.today - datetime.timedelta(days=days_ago), datetime.time(hour))
        return timezone.make_aware(value).isoformat()

    def join(self, candidate, code, **data):
        participation = CandidateParticipation.objects.create(candidate=candidate, session=self.sessions[code])
        if data:
            participation.registration_data = data
            participation.save()
        return participation

    def test_counts_today_and_yesterday_per_session_and_new_codes(self):
        new = self.candidate('FT-91001')
        self.join(new, 'FIMO')                                  # nhập tay hôm nay
        self.join(new, 'FIEO', registeredAt=self.at(0))         # trang đăng ký hôm nay
        late = self.candidate('FT-91002')                       # dòng Form gửi hôm qua, nhập hôm nay
        self.join(late, 'FIMO', registeredAt=self.at(0), formSubmittedAt=self.at(1, 20))
        returning = self.candidate('FT-91003')                  # thí sinh cũ đăng ký thêm cuộc thi
        self.join(returning, 'FIMO', registeredAt=self.at(40))
        self.join(returning, 'FIEO', registeredAt=self.at(0))
        old = self.candidate('FT-91004')
        self.join(old, 'FIMO', historicalImport=True)           # dữ liệu lịch sử: không tính
        moved = self.candidate('FT-91005')
        CandidateParticipation.objects.create(candidate=moved, session=self.sessions['FIEO'], source='Đổi từ FIMO')
        stats = daily_registration_stats(self.today)
        self.assertEqual(stats['today']['total'], 3)
        self.assertEqual(stats['today']['bySession'], {SESSION_IDS['FIMO']: 1, SESSION_IDS['FIEO']: 2})
        self.assertEqual(stats['today']['newCandidates'], 1, 'only FT-91001 is a new code today')
        self.assertEqual(stats['today']['newCandidateSessions'], [sorted([SESSION_IDS['FIMO'], SESSION_IDS['FIEO']])])
        self.assertEqual(stats['yesterday'], {'total': 1, 'bySession': {SESSION_IDS['FIMO']: 1}, 'newCandidates': 1,
                                              'newCandidateSessions': [[SESSION_IDS['FIMO']]]})

    def test_web_registration_then_later_form_row_keeps_first_day(self):
        candidate = self.candidate('FT-91010')
        self.join(candidate, 'FIMO', registeredAt=self.at(3), formSubmittedAt=self.at(0))
        stats = daily_registration_stats(self.today)
        self.assertEqual(stats['today']['total'], 0)

    def test_form_import_records_submission_time(self):
        self.assertEqual(submitted_at(['24/11/2026 21:43:22'])[:19], '2026-11-24T21:43:22')
        self.assertEqual(submitted_at(['abc']), '')
        row = [''] * 17
        row[0], row[2], row[3], row[4], row[12] = '24/11/2026 21:43:22', 'Trần Thị Thử', '01/01/2017', '001201099999', 'FIMO'
        with patch.dict('os.environ', {'EXAMINATION_REGISTRATION_WEBHOOK_SECRET': 'test-secret'}):
            self.client.post('/api/examination/form-registration/webhook', {
                'spreadsheetId': SPREADSHEET_ID, 'sheetTab': 'FIMO, FIEO', 'rows': [{'rowNumber': 2, 'values': row}],
            }, content_type='application/json', HTTP_X_EXAMINATION_WEBHOOK_SECRET='test-secret')
        participation = CandidateParticipation.objects.get()
        self.assertEqual(participation.registration_data['formSubmittedAt'][:19], '2026-11-24T21:43:22')

    def test_endpoint_requires_login_and_returns_stats(self):
        client = APIClient()
        self.assertIn(client.get('/api/examination/registration-stats').status_code, (401, 403))
        client.force_authenticate(UserProfile.objects.create(email='stats@example.test', name='Stats', role='EMPLOYEE', access_modules=['examination']))
        response = client.get('/api/examination/registration-stats')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['date'], self.today.isoformat())
