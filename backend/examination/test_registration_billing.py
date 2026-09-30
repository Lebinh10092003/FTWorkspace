from unittest.mock import MagicMock, patch
from datetime import timedelta
import json
import uuid

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from authentication.models import JobTitle, UserProfile, WorkspaceNotification
from .form_registration import SESSION_IDS, SPREADSHEET_ID, selected_codes
from .models import Candidate, CandidateParticipation, ExamSession, ExaminationBillingRecord, ExaminationSheet, FormRegistrationLink, PublicExamRegistration, UnmatchedTransfer
from .public_registration_sheet import row_for, sync_registration
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

    def public_payload(self):
        return {
            'requestKey': str(uuid.uuid4()), 'contestCodes': json.dumps(['SIBO', 'FIEO']),
            'name': 'Nguyễn Minh An', 'birthDate': '2018-07-12',
            'email': 'parent@example.test', 'phone': '0912345678',
            'school': 'Trường A', 'grade': '3', 'city': 'Hà Nội',
            'ward': 'Phường A', 'address': 'Số 1, đường B',
            'paymentDeclared': 'true',
        }

    def test_public_form_creates_one_candidate_two_billing_records_and_is_idempotent(self):
        payload = self.public_payload()
        payload['proof'] = SimpleUploadedFile('proof.png', b'\x89PNG\r\n\x1a\n' + b'x' * 20, content_type='image/png')
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post('/api/public/examination/registration', payload, format='multipart')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Candidate.objects.count(), 1)
        self.assertEqual(CandidateParticipation.objects.count(), 2)
        self.assertEqual(ExaminationBillingRecord.objects.count(), 2)
        self.assertEqual(WorkspaceNotification.objects.filter(title='Thí sinh mới cần đối soát').count(), 2)
        self.assertEqual(WorkspaceNotification.objects.filter(title='Thí sinh mới đăng ký').count(), 2)
        self.assertEqual(PublicExamRegistration.objects.count(), 1)
        retry = self.client.post('/api/public/examination/registration', self.public_payload() | {'requestKey': payload['requestKey']}, format='multipart')
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(CandidateParticipation.objects.count(), 2)
        self.assertEqual(retry.data['registrationId'], response.data['registrationId'])
        self.assertNotEqual(self.client.get(f"/api/examination/public-registrations/{response.data['registrationId']}/proof").status_code, 200)
        self.client.force_authenticate(self.finance)
        self.assertEqual(self.client.get(f"/api/examination/public-registrations/{response.data['registrationId']}/proof").status_code, 200)

    def test_public_sheet_export_uses_original_tabs_and_webhook_ignores_its_rows(self):
        response = self.client.post('/api/public/examination/registration', self.public_payload(), format='multipart')
        self.assertEqual(response.status_code, 201, response.data)
        item = PublicExamRegistration.objects.select_related('candidate').get()
        self.assertEqual(row_for(item, 'SIPhO, SIChO, SIBO, SILSO')[12], 'SIBO')
        self.assertEqual(row_for(item, 'FIMO, FIEO')[12], 'FIEO')
        self.assertEqual(row_for(item, 'FIMO, FIEO')[17], f'WORKSPACE:{item.id}')
        sheet = MagicMock()
        sheet.spreadsheets.return_value.get.return_value.execute.return_value = {
            'sheets': [{'properties': {'title': tab, 'sheetId': number, 'gridProperties': {'columnCount': 18}}}
                       for number, tab in enumerate(('SIPhO, SIChO, SIBO, SILSO', 'FIMO, FIEO'))],
        }
        def values_get(**kwargs):
            result = MagicMock()
            result.execute.return_value = {'values': [['Mã đăng ký Workspace']]} if kwargs['range'].endswith('R1') else {'values': []}
            return result
        sheet.spreadsheets.return_value.values.return_value.get.side_effect = values_get
        sheet.spreadsheets.return_value.values.return_value.append.return_value.execute.return_value = {'updates': {'updatedRange': "'FIMO, FIEO'!A2:R2"}}
        sync_registration(item, service=sheet)
        self.assertEqual(sheet.spreadsheets.return_value.values.return_value.append.call_count, 2)
        item.refresh_from_db()
        self.assertEqual(item.sheet_status, 'synced')
        row = row_for(item, 'FIMO, FIEO')
        with patch.dict('os.environ', {'EXAMINATION_REGISTRATION_WEBHOOK_SECRET': 'test-secret'}):
            imported = self.client.post('/api/examination/form-registration/webhook', {
                'spreadsheetId': SPREADSHEET_ID, 'sheetTab': 'FIMO, FIEO',
                'rows': [{'rowNumber': 2, 'values': row}],
            }, format='json', HTTP_X_EXAMINATION_WEBHOOK_SECRET='test-secret')
        self.assertEqual(imported.status_code, 200)
        self.assertEqual(imported.data['skipped'], 1)
        self.assertEqual(CandidateParticipation.objects.count(), 2)

    def test_signed_apps_script_pull_and_ack_are_idempotent(self):
        created = self.client.post('/api/public/examination/registration', self.public_payload(), format='multipart')
        self.assertEqual(created.status_code, 201, created.data)
        pending_url = '/api/examination/form-registration/workspace-pending'
        ack_url = '/api/examination/form-registration/workspace-ack'
        self.assertEqual(self.client.post(pending_url, {}, format='json').status_code, 403)
        with patch.dict('os.environ', {'EXAMINATION_REGISTRATION_WEBHOOK_SECRET': 'test-secret'}):
            pending = self.client.post(pending_url, {}, format='json', HTTP_X_EXAMINATION_WEBHOOK_SECRET='test-secret')
            self.assertEqual(pending.status_code, 200)
            self.assertEqual(len(pending.data['registrations']), 1)
            self.assertEqual(set(pending.data['registrations'][0]['tabs']), {'SIPhO, SIChO, SIBO, SILSO', 'FIMO, FIEO'})
            for tab in ('SIPhO, SIChO, SIBO, SILSO', 'FIMO, FIEO'):
                ack = self.client.post(ack_url, {
                    'registrationId': created.data['registrationId'], 'sheetTab': tab, 'rowNumber': 2,
                }, format='json', HTTP_X_EXAMINATION_WEBHOOK_SECRET='test-secret')
                self.assertEqual(ack.status_code, 200)
            again = self.client.post(pending_url, {}, format='json', HTTP_X_EXAMINATION_WEBHOOK_SECRET='test-secret')
            self.assertEqual(again.data['registrations'], [])
            self.assertEqual(PublicExamRegistration.objects.get().sheet_status, 'synced')

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

    def test_past_sessions_are_excluded_from_records_and_totals_without_deleting_history(self):
        today = timezone.localdate()
        current = ExamSession.objects.get(pk=SESSION_IDS['FIMO'])
        current.rounds = [{'name': 'Vòng cuối', 'date': (today + timedelta(days=7)).isoformat()}]
        current.save()
        past = ExamSession.objects.create(id='fimo-past', competition_id='fimo', code='FIMO',
            name='FIMO cũ', parent='FIMO', organizer='Test', time='Kỳ cũ', sort_key='past',
            rounds=[{'name': 'Vòng cuối', 'date': (today - timedelta(days=1)).isoformat()}])
        candidate = Candidate.objects.create(id='billing-scope', code='FT-09991', name='Thí sinh đối soát', sort_key='test')
        active_record = CandidateParticipation.objects.create(candidate=candidate, session=current).billing
        active_record.amount = 650000
        active_record.save()
        old_record = CandidateParticipation.objects.create(candidate=candidate, session=past).billing
        old_record.amount = 900000
        old_record.transfer_status = 'confirmed'
        old_record.invoice_status = 'checked'
        old_record.save()
        self.client.force_authenticate(self.finance)
        active = self.client.get('/api/examination/billing/records')
        self.assertEqual([row['sessionId'] for row in active.data], [current.pk])
        totals = self.client.get('/api/examination/billing/stats').data
        self.assertEqual(totals['newCandidates'], 1)
        self.assertEqual(totals['awaitingTransfer'], 1)
        self.assertEqual(totals['totalAmount'], 650000)
        self.assertEqual(totals['collectedAmount'], 0)
        history = self.client.get('/api/examination/billing/records?scope=past')
        self.assertEqual([row['sessionId'] for row in history.data], [past.pk])
        self.assertEqual(self.client.get('/api/examination/billing/stats?scope=past').data['collectedAmount'], 900000)
        self.assertEqual(len(self.client.get('/api/examination/billing/records?scope=all').data), 2)
        self.assertEqual(ExaminationBillingRecord.objects.count(), 2)
        self.assertEqual(self.client.get('/api/examination/billing/records?scope=unknown').status_code, 400)

    def test_past_round_does_not_hide_an_upcoming_or_undated_later_round(self):
        from .billing_views import session_is_past
        today = timezone.localdate()
        session = ExamSession.objects.get(pk=SESSION_IDS['FIMO'])
        session.rounds = [
            {'name': 'Quốc gia', 'date': (today - timedelta(days=60)).isoformat()},
            {'name': 'Quốc tế', 'date': '', 'slots': [{'date': (today + timedelta(days=10)).isoformat()}]},
        ]
        self.assertFalse(session_is_past(session, today))
        session.rounds[1]['slots'] = []
        self.assertFalse(session_is_past(session, today))
        session.rounds = []
        session.national_date = None
        session.international_date = None
        self.assertFalse(session_is_past(session, today))
        session.phase = 'Hoàn thành'
        self.assertTrue(session_is_past(session, today))

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
