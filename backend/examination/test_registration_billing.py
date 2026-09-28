from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from authentication.models import JobTitle, UserProfile, WorkspaceNotification
from .form_registration import SESSION_IDS, SPREADSHEET_ID, selected_codes
from .models import Candidate, CandidateParticipation, ExamSession, ExaminationBillingRecord, ExaminationSheet, FormRegistrationLink, UnmatchedTransfer
from .sheet_scheduler import scan_sheet_changes


class RegistrationAndBillingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        for code, session_id in SESSION_IDS.items():
            ExamSession.objects.get_or_create(
                id=session_id, defaults=dict(competition_id=code.lower(), code=code, name=code,
                parent=code, organizer='Test', time='2026–2027', sort_key=code),
            )
        accountant, _ = JobTitle.objects.get_or_create(name='Kế toán')
        self.finance = UserProfile.objects.create(email='finance@example.test', role='EMPLOYEE', access_modules=['finance-report'], job_title=accountant)
        self.exam = UserProfile.objects.create(email='exam@example.test', role='EMPLOYEE', access_modules=['examination'])

    def registration_row(self, contests='SIBO – Biology; SIChO – Chemistry'):
        row = [''] * 16
        row[0] = '28/09/2026 15:25:00'
        row[2] = 'Nguyễn Minh An'
        row[3] = '12/07/2018'
        row[4] = '001201012345'
        row[5] = 'parent@example.test'
        row[9] = '0912345678'
        row[10] = 'Trường A'
        row[12] = contests
        return row

    def test_grouped_form_registers_only_selected_contests_and_retries_safely(self):
        tab = 'SIPhO, SIChO, SIBO, SILSO'
        self.assertEqual(selected_codes(tab, self.registration_row()), ['SICHO', 'SIBO'])
        payload = {'spreadsheetId': SPREADSHEET_ID, 'sheetTab': tab, 'rows': [{'rowNumber': 2, 'values': self.registration_row()}]}
        with patch.dict('os.environ', {'EXAMINATION_REGISTRATION_WEBHOOK_SECRET': 'test-secret'}):
            rejected = self.client.post('/api/examination/form-registration/webhook', payload, format='json')
            self.assertEqual(rejected.status_code, 403)
            with self.captureOnCommitCallbacks(execute=True):
                first = self.client.post('/api/examination/form-registration/webhook', payload, format='json', HTTP_X_EXAMINATION_WEBHOOK_SECRET='test-secret')
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.data['created'], 1)
            self.assertEqual(Candidate.objects.count(), 1)
            self.assertEqual({code.upper() for code in CandidateParticipation.objects.values_list('session__code', flat=True)}, {'SICHO', 'SIBO'})
            self.assertEqual(ExaminationBillingRecord.objects.count(), 2)
            self.assertEqual(WorkspaceNotification.objects.filter(title='Thí sinh mới cần đối soát').count(), 2)
            again = self.client.post('/api/examination/form-registration/webhook', payload, format='json', HTTP_X_EXAMINATION_WEBHOOK_SECRET='test-secret')
            self.assertEqual(again.status_code, 200)
            self.assertEqual(Candidate.objects.count(), 1)
            self.assertEqual(CandidateParticipation.objects.count(), 2)
            self.assertEqual(FormRegistrationLink.objects.count(), 2)

    def test_other_form_tabs_keep_their_own_contest_selection(self):
        row = self.registration_row('FIEO – English')
        self.assertEqual(selected_codes('FIMO, FIEO', row), ['FIEO'])
        self.assertEqual(selected_codes('SIAIO', row), ['SIAIO'])
        self.assertEqual(selected_codes('SIPhO, SIChO, SIBO, SILSO', row), [])

    def test_accounting_and_exam_resolve_an_unmatched_transfer(self):
        candidate = Candidate.objects.create(id='FT-00001', code='FT-00001', name='Học sinh A', sort_key='a')
        participation = CandidateParticipation.objects.create(candidate=candidate, session=ExamSession.objects.get(pk=SESSION_IDS['FIMO']))
        self.client.force_authenticate(self.finance)
        amount = self.client.post(f'/api/examination/billing/records/{participation.billing.pk}/amount', {'amount': 650000}, format='json')
        self.assertEqual(amount.status_code, 200)
        transfer = self.client.post(f'/api/examination/billing/records/{participation.billing.pk}/transfer', {'reference': 'VCB123'}, format='json')
        self.assertEqual(transfer.status_code, 200)
        invoice = self.client.post(f'/api/examination/billing/records/{participation.billing.pk}/invoice', {'invoiceNumber': 'HD-001'}, format='json')
        self.assertEqual(invoice.status_code, 200)
        self.assertEqual(self.client.get('/api/examination/billing/stats').data['completed'], 1)
        image = SimpleUploadedFile('transfer.png', b'\x89PNG\r\n\x1a\n' + b'x' * 20, content_type='image/png')
        with self.captureOnCommitCallbacks(execute=True):
            created = self.client.post('/api/examination/billing/unmatched', {'amount': '700000', 'reference': 'UNKNOWN', 'note': 'Chưa thấy tên', 'image': image}, format='multipart')
        self.assertEqual(created.status_code, 201)
        item_id = created.data['id']
        self.assertEqual(self.client.get(f'/api/examination/billing/unmatched/{item_id}/image').status_code, 200)
        self.client.force_authenticate(self.exam)
        self.assertEqual(self.client.get('/api/examination/billing/stats').status_code, 403)
        resolved = self.client.post(f'/api/examination/billing/unmatched/{item_id}/resolve', {
            'candidateCode': 'FT-00001', 'competitionCode': 'FIMO', 'resolutionNote': 'Đã tìm thấy hồ sơ.',
        }, format='json')
        self.assertEqual(resolved.status_code, 200)
        self.assertEqual(resolved.data['status'], 'matched')
        self.assertEqual(UnmatchedTransfer.objects.get(pk=item_id).matched_participation, participation)

    def test_private_form_source_is_not_scanned_by_generic_sheet_import(self):
        now = timezone.now()
        sheet = ExaminationSheet.objects.create(
            id='private-form-test', name='Private form', url='https://docs.google.com/spreadsheets/d/private/edit',
            session_id=SESSION_IDS['FIMO'], sheet_tab='FIMO, FIEO', stage='form-webhook',
            automation_enabled=True, created_at=now, updated_at=now,
        )
        with patch('examination.sheet_scheduler.tab_content_fingerprint') as fingerprint:
            result = scan_sheet_changes(sheets=[sheet])
        fingerprint.assert_not_called()
        self.assertEqual(result['checked'], 0)
