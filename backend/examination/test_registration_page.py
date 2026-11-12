import importlib
import json
import uuid
from copy import deepcopy
from unittest.mock import MagicMock, patch
from django.apps import apps
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from authentication.models import UserProfile
from .registration_test_utils import open_rounds
from .form_registration import SESSION_IDS
from .models import Candidate, CandidateParticipation, ExamSession, ExaminationSheet
from .registration_page import DEFAULT_CONTENT


class RegistrationPageTests(TestCase):
    def test_verified_fermat_form_saves_required_information_before_payment_proof(self):
        public = APIClient()
        option = next(item for item in public.get('/api/public/examination/registration').data['competitions'] if item['code'] == 'FIMO')
        self.assertTrue(option['proofRequired'])
        self.assertEqual(option['maxGrade'], 9)
        self.assertEqual(option['fee'], 250000)
        self.assertIn('identity', option['requiredFields'])
        payload = self.payload() | {'contestCodes': '["FIMO"]', 'identity': '001201012345',
            'className': '3A1', 'submitterEmail': 'registrant@example.test'}
        for key in ('identity', 'className', 'submitterEmail'):
            with self.subTest(key=key):
                incomplete = {**payload, key: ''}
                self.assertEqual(public.post('/api/public/examination/registration', incomplete, format='multipart').status_code, 400)
        valid = public.post('/api/public/examination/registration', payload, format='multipart')
        self.assertEqual(valid.status_code, 201, valid.data)
        self.assertFalse(valid.data['payment']['proofReceived'])
        self.assertEqual(valid.data['payment']['paymentStatus'], 'pending')
        self.assertEqual(valid.data['payment']['total'], 250000)
        self.assertEqual(CandidateParticipation.objects.get().registration_data['submitterEmail'], 'registrant@example.test')

    def test_editor_uses_public_sco_codes_for_legacy_named_competitions(self):
        session = ExamSession.objects.create(id='imo-future', competition_id='legacy-imo', code='IMO',
            name='IMO mùa mới', parent='SCO', organizer='SCO', time='2028', sort_key='imo')
        response = self.client.get('/api/examination/registration-page')
        row = next(item for item in response.data['sessionStatus'] if item['sessionId'] == session.id)
        self.assertEqual(row['code'], 'SIMO')
        self.assertEqual(row['status'], 'missing-deadline')

    def test_any_session_in_its_registration_window_is_listed_with_its_entry_round_fee(self):
        session = ExamSession.objects.create(id='simo-new-season', competition_id='simo', code='SIMO',
            name='SIMO mùa mới', parent='SCO', organizer='SCO', time='2027–2028', sort_key='simo',
            rounds=open_rounds(fee=320000, later=[('Vòng Chung kết Quốc tế', 1500000)]))
        public = APIClient()
        option = next(item for item in public.get('/api/public/examination/registration').data['competitions'] if item['code'] == 'SIMO')
        self.assertEqual(option['sessionId'], session.id)
        self.assertEqual(option['fee'], 320000)
        self.assertEqual(option['entryRound'], 'Vòng loại Quốc gia')
        self.assertEqual(option['laterRounds'], [{'name': 'Vòng Chung kết Quốc tế', 'fee': 1500000}])
        payload = self.payload() | {'contestCodes': '["SIMO"]', 'parentName': 'Trần Minh', 'className': '3A1'}
        result = public.post('/api/public/examination/registration', payload, format='multipart')
        self.assertEqual(result.status_code, 201, result.data)
        participation = CandidateParticipation.objects.get()
        self.assertEqual(participation.session_id, session.id)
        self.assertEqual(participation.candidate.parent, 'Trần Minh')
        self.assertEqual(participation.candidate.class_name, '3A1')
        self.assertEqual(participation.billing.amount, 320000)
        self.assertEqual(participation.billing.transfer_status, 'pending')
        self.assertEqual(participation.registration_data['registrationFee'], 320000)
        self.assertEqual(participation.registration_data['registrationRound'], 'Vòng loại Quốc gia')
        self.assertFalse(participation.candidate.exam_history)

    def test_window_needs_open_phase_and_four_months_before_deadline(self):
        from datetime import timedelta
        from .registration_window import open_registration_sessions, session_offer
        today = timezone.localdate()

        def session(pk, code, phase='Tuyển sinh', **round_values):
            entry = {'id': 'r', 'name': 'Vòng 1', 'date': '', 'slots': [], 'fee': None, 'registrationDeadline': ''} | round_values
            return ExamSession.objects.create(id=pk, competition_id=code, code=code, name=pk, parent=code,
                organizer='Test', time='', sort_key=pk, phase=phase, rounds=[entry])
        far = session('far', 'TESTA', registrationDeadline=(today + timedelta(days=150)).isoformat())
        past = session('past', 'TESTB', registrationDeadline=(today - timedelta(days=1)).isoformat())
        closed = session('closed', 'TESTC', phase='Vòng quốc gia', registrationDeadline=(today + timedelta(days=10)).isoformat())
        by_exam_date = session('by-date', 'TESTD', phase='Chuẩn bị/Truyền thông', date=(today + timedelta(days=20)).isoformat())
        missing = session('missing', 'TESTE')
        self.assertEqual(session_offer(far)['status'], 'not-yet')
        self.assertEqual(session_offer(past)['status'], 'expired')
        self.assertEqual(session_offer(closed)['status'], 'closed-phase')
        self.assertEqual(session_offer(missing)['status'], 'missing-deadline')
        offer = session_offer(by_exam_date)
        self.assertEqual((offer['status'], offer['deadline'], offer['fee']), ('open', (today + timedelta(days=20)).isoformat(), None))
        later_fimo = session('fimo-later', 'FIMO', registrationDeadline=(today + timedelta(days=90)).isoformat())
        listed = open_registration_sessions()
        self.assertEqual(set(listed) & {'TESTA', 'TESTB', 'TESTC', 'TESTE'}, set())
        self.assertIn('TESTD', listed)
        self.assertEqual(listed['FIMO'][0].id, SESSION_IDS['FIMO'])  # hạn sớm hơn được chọn
        self.assertNotEqual(listed['FIMO'][0].id, later_fimo.id)
        self.assertNotIn('FIMO', open_registration_sessions(['FIMO']))

    def test_multi_batch_entry_round_uses_the_next_open_batch(self):
        from datetime import timedelta
        from .registration_window import session_offer
        today = timezone.localdate()
        day = lambda offset: (today + timedelta(days=offset)).isoformat()
        slots = [{'id': 'b1', 'date': day(-30), 'registrationDeadline': day(-37)},
                 {'id': 'b2', 'date': day(24), 'registrationDeadline': day(17)},
                 {'id': 'b3', 'date': day(108), 'registrationDeadline': ''}]
        session = ExamSession.objects.create(id='fimo-batches', competition_id='TESTF', code='TESTF', name='batches',
            parent='FT', organizer='FT', time='', sort_key='batches', phase='Tuyển sinh',
            rounds=[{'id': 'q', 'name': 'Vòng loại Quốc gia', 'date': day(-30), 'slots': slots, 'fee': 250000}])
        offer = session_offer(session)
        self.assertEqual((offer['status'], offer['deadline'], offer['deadlineIsExplicit']), ('open', day(17), True))
        self.assertEqual(offer['entryRound'], 'Vòng loại Quốc gia · đợt 2')
        later = session_offer(session, today + timedelta(days=20))
        self.assertEqual((later['deadline'], later['deadlineIsExplicit'], later['entryRound']), (day(108), False, 'Vòng loại Quốc gia · đợt 3'))
        self.assertEqual(session_offer(session, today + timedelta(days=120))['status'], 'expired')

    def test_unknown_fee_is_saved_without_an_amount(self):
        ExamSession.objects.filter(pk=SESSION_IDS['SIAIO']).update(rounds=open_rounds(fee=None))
        option = next(item for item in APIClient().get('/api/public/examination/registration').data['competitions'] if item['code'] == 'SIAIO')
        self.assertIsNone(option['fee'])
        result = APIClient().post('/api/public/examination/registration', self.payload(), format='multipart')
        self.assertEqual(result.status_code, 201, result.data)
        participation = CandidateParticipation.objects.get()
        self.assertIsNone(participation.registration_data['registrationFee'])
        self.assertIsNone(result.data['payment']['total'])

    def test_session_editor_keeps_round_fee_and_registration_deadline(self):
        session = ExamSession.objects.get(pk=SESSION_IDS['SIBO'])
        rounds = [{'id': 'r1', 'name': 'Vòng loại', 'date': '2027-01-10', 'slots': [{'id': 's1', 'date': '2027-01-10', 'registrationDeadline': '2027-01-03'}, {'id': 's2', 'date': '2027-02-10', 'registrationDeadline': 'sai'}], 'fee': '350.000', 'registrationDeadline': '2026-12-20'},
                  {'id': 'r2', 'name': 'Chung kết', 'date': '', 'slots': [], 'fee': -5, 'registrationDeadline': 'không rõ'}]
        response = self.client.put(f'/api/examination/sessions/{session.id}', {'rounds': rounds}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        session.refresh_from_db()
        self.assertEqual([(item['fee'], item['registrationDeadline']) for item in session.rounds], [(350000, '2026-12-20'), (None, '')])
        self.assertEqual([slot['registrationDeadline'] for slot in session.rounds[0]['slots']], ['2027-01-03', ''])

    def test_invalid_hidden_codes_and_mismatched_class_are_rejected(self):
        content = deepcopy(DEFAULT_CONTENT)
        content['hiddenCodes'] = ['không hợp lệ']
        self.assertEqual(self.publish(content).status_code, 400)
        response = APIClient().post('/api/public/examination/registration', self.payload() | {'className': '6A1'}, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(CandidateParticipation.objects.exists())

    def setUp(self):
        self.client = APIClient()
        self.admin = UserProfile.objects.create(email='page-admin@example.test', role='ADMIN')
        self.client.force_authenticate(self.admin)
        for code, session_id in SESSION_IDS.items():
            ExamSession.objects.get_or_create(pk=session_id, defaults=dict(competition_id=code, code=code,
                name=code, parent=code, organizer='Test', time='2026–2027', sort_key=code))
        ExamSession.objects.filter(pk__in=list(SESSION_IDS.values())).update(rounds=open_rounds(), phase='Tuyển sinh')

    def publish(self, content):
        return self.client.post('/api/examination/registration-page', {'action': 'publish', 'content': content}, format='json')

    def payload(self):
        return dict(requestKey=str(uuid.uuid4()), contestCodes=json.dumps(['SIAIO']), name='Nguyễn Minh An',
                    birthDate='2018-07-12', email='parent@example.test', phone='0912345678', school='Trường A',
                    grade='3', city='Hà Nội', ward='Phường A', address='Số 12')

    def test_draft_and_publication_are_separate_and_can_close(self):
        draft = deepcopy(DEFAULT_CONTENT)
        draft['title'] = 'Nội dung đang chỉnh'
        response = self.client.put('/api/examination/registration-page', {'content': draft}, format='json')
        self.assertEqual(response.status_code, 200)
        public = APIClient()
        self.assertEqual(public.get('/api/public/examination/registration').data['content']['title'], DEFAULT_CONTENT['title'])
        self.assertEqual(self.publish(draft).status_code, 200)
        self.assertEqual(public.get('/api/public/examination/registration').data['content']['title'], draft['title'])
        self.client.post('/api/examination/registration-page', {'action': 'unpublish'}, format='json')
        self.assertEqual(public.get('/api/public/examination/registration').status_code, 403)
        self.assertEqual(public.post('/api/public/examination/registration', self.payload(), format='multipart').status_code, 403)
        self.assertEqual(CandidateParticipation.objects.count(), 0)

    def test_editor_requires_module_access_and_write_role(self):
        anonymous = APIClient().get('/api/examination/registration-page')
        self.assertIn(anonymous.status_code, (401, 403))
        finance = UserProfile.objects.create(email='page-finance@example.test', role='MANAGER', access_modules=['finance-report'])
        self.client.force_authenticate(finance)
        self.assertEqual(self.client.get('/api/examination/registration-page').status_code, 403)
        employee = UserProfile.objects.create(email='page-exam@example.test', role='EMPLOYEE', access_modules=['examination'])
        self.client.force_authenticate(employee)
        self.assertEqual(self.client.get('/api/examination/registration-page').status_code, 200)
        self.assertEqual(self.publish(DEFAULT_CONTENT).status_code, 403)

    def test_hidden_fields_and_custom_answers_follow_published_schema(self):
        content = deepcopy(DEFAULT_CONTENT)
        for field in content['fields']:
            if field['key'] != 'name':
                field['enabled'] = False
        content['fields'].append(dict(key='custom_language', label='Ngôn ngữ thi', type='select', options=['Việt', 'Anh'], enabled=True, required=True, section='extra'))
        content['hiddenCodes'] = ['FIMO', 'FIEO']
        self.assertEqual(self.publish(content).status_code, 200)
        public = APIClient()
        payload = dict(requestKey=str(uuid.uuid4()), contestCodes='["SIAIO"]', name='Nguyễn Minh An', email='invalid')
        self.assertEqual(public.post('/api/public/examination/registration', payload, format='multipart').status_code, 400)
        payload['customAnswers'] = json.dumps({'custom_language': 'Anh'})
        result = public.post('/api/public/examination/registration', payload, format='multipart')
        self.assertEqual(result.status_code, 201, result.data)
        candidate = Candidate.objects.get(code=result.data['candidateCode'])
        self.assertEqual(candidate.email, '')
        answer = CandidateParticipation.objects.get(candidate=candidate).registration_data['customAnswers'][0]
        self.assertEqual(answer, {'key': 'custom_language', 'label': 'Ngôn ngữ thi', 'value': 'Anh'})
        detail = self.client.get('/api/examination/bootstrap')
        self.assertEqual(detail.status_code, 200)
        record = next(row for row in detail.data['candidates'] if row['code'] == candidate.code)
        self.assertEqual(record['participations'][0]['registration']['customAnswers'][0], answer)
        self.assertEqual(public.post('/api/public/examination/registration', payload, format='multipart').status_code, 200)

    def test_disabled_contests_and_invalid_field_schemas_are_rejected(self):
        content = deepcopy(DEFAULT_CONTENT)
        content['hiddenCodes'] = ['FIMO', 'FIEO']
        self.assertEqual(self.publish(content).status_code, 200)
        payload = self.payload()
        payload['contestCodes'] = '["FIMO"]'
        self.assertEqual(APIClient().post('/api/public/examination/registration', payload, format='multipart').status_code, 400)
        content['fields'][0]['enabled'] = False
        self.assertEqual(self.publish(content).status_code, 400)
        content = deepcopy(DEFAULT_CONTENT)
        content['fields'].append(deepcopy(content['fields'][0]))
        self.assertEqual(self.publish(content).status_code, 400)


class EmptySheetReconciliationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(UserProfile.objects.create(email='empty-admin@example.test', role='ADMIN'))
        self.session = ExamSession.objects.create(id='empty-session', competition_id='siaio', code='SIAIO',
            name='SIAIO', parent='SCO', organizer='SCO', time='2026–2027', sort_key='empty')
        self.sheet = ExaminationSheet.objects.create(id='empty-source', session_id=self.session.id,
            name='SCO - SIAIO', url='https://docs.google.com/spreadsheets/d/example/edit', stage='registration-source', created_at=timezone.now(), updated_at=timezone.now())

    @patch('examination.sync.requests.get')
    def test_remove_only_import_works_with_header_only_sheet_and_does_not_delete_profile(self, get):
        get.return_value = MagicMock(status_code=200, text='Họ và tên thí sinh,Email\n', url='https://docs.google.com/export.csv')
        candidate = Candidate.objects.create(id='FT-00324', code='FT-00324', name='`',
            contests='SIAIO', session_ids=[self.session.id], sort_key='placeholder')
        CandidateParticipation.objects.create(candidate=candidate, session=self.session)
        preview = self.client.post('/api/examination/sheets/preview', {'id': self.sheet.id}, format='json')
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.data['summary']['total'], 0)
        result = self.client.post('/api/examination/import/candidates', dict(records=[], sessionId=self.session.id,
            sheetId=self.sheet.id, sourceFingerprint=preview.data['source']['fingerprint'],
            removeSessionCandidateCodes=[candidate.code]), format='json')
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data['removedFromSession'], 1)
        candidate.refresh_from_db()
        self.session.refresh_from_db()
        self.assertEqual(candidate.session_ids, [])
        self.assertEqual(self.session.candidates_count, 0)
        self.assertFalse(candidate.participations.exists())

    @patch('examination.sync.requests.get')
    def test_symbol_only_rows_are_skipped_and_stale_removal_is_rejected(self, get):
        get.return_value = MagicMock(status_code=200, text='Họ và tên thí sinh,Email\n`,\n---,\n', url='https://docs.google.com/export.csv')
        preview = self.client.post('/api/examination/sheets/preview', {'id': self.sheet.id}, format='json')
        self.assertEqual(preview.data['summary']['total'], 0)
        result = self.client.post('/api/examination/import/candidates', dict(records=[], sessionId=self.session.id,
            sheetId=self.sheet.id, sourceFingerprint='outdated', removeSessionCandidateCodes=['FT-00324']), format='json')
        self.assertEqual(result.status_code, 409)

    def test_manual_import_skips_symbols(self):
        result = self.client.post('/api/examination/import/candidates', {'sessionId': self.session.id,
            'records': [{'name': '`'}, {'name': '---'}]}, format='json')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data['created'], 0)

    def test_cleanup_preserves_identified_profiles(self):
        placeholder = Candidate.objects.create(id='empty', code='empty', name='`', contests='SIAIO', session_ids=[self.session.id], sort_key='empty')
        protected = Candidate.objects.create(id='protected', code='protected', name='`', identity='001234567890', session_ids=[self.session.id], sort_key='protected')
        CandidateParticipation.objects.create(candidate=placeholder, session=self.session)
        CandidateParticipation.objects.create(candidate=protected, session=self.session)
        importlib.import_module('examination.migrations.0048_detach_placeholder_registrations').detach_placeholders(apps, None)
        placeholder.refresh_from_db()
        self.session.refresh_from_db()
        self.assertEqual(placeholder.session_ids, [])
        self.assertTrue(Candidate.objects.filter(pk=placeholder.pk).exists())
        self.assertTrue(protected.participations.exists())
        self.assertEqual(self.session.candidates_count, 1)

    def test_cleanup_preserves_a_placeholder_with_payment_data(self):
        candidate = Candidate.objects.create(id='paid-placeholder', code='paid-placeholder', name='`',
            session_ids=[self.session.id], sort_key='paid')
        participation = CandidateParticipation.objects.create(candidate=candidate, session=self.session)
        billing = participation.billing
        billing.amount = 100000
        billing.save()
        importlib.import_module('examination.migrations.0048_detach_placeholder_registrations').detach_placeholders(apps, None)
        self.assertTrue(candidate.participations.exists())
        billing.refresh_from_db()
        self.assertEqual(billing.amount, 100000)
