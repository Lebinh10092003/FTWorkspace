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
from .form_registration import SESSION_IDS
from .models import Candidate, CandidateParticipation, ExamSession, ExaminationSheet
from .registration_page import DEFAULT_CONTENT


class RegistrationPageTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = UserProfile.objects.create(email='page-admin@example.test', role='ADMIN')
        self.client.force_authenticate(self.admin)
        for code, session_id in SESSION_IDS.items():
            ExamSession.objects.get_or_create(pk=session_id, defaults=dict(competition_id=code, code=code,
                name=code, parent=code, organizer='Test', time='2026–2027', sort_key=code))

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
        content['competitionCodes'] = ['SIAIO']
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
        content['competitionCodes'] = ['SIAIO']
        self.publish(content)
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
