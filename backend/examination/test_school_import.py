import io
import json
from unittest.mock import MagicMock, patch

import openpyxl
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from authentication.models import SystemConfig, UserProfile
from .models import Candidate, CandidateParticipation, CandidateSheetOutbox, ExamRoom, ExamSession, ExaminationBillingRecord, ExaminationSheet, RoundResult, SchoolRegistration, SessionSheetOutbox, TransferProof
from .proof_archive import archive_pending, folder_for
from .school_import import read_workbook


class SchoolImportTests(TestCase):
    def setUp(self):
        # Seed migrations contain real seasons; isolate the school fixture.
        self.client = APIClient()
        self.user = UserProfile.objects.create(email='exam-import@example.test', role='EMPLOYEE', access_modules=['examination'])
        self.finance = UserProfile.objects.create(email='finance-import@example.test', role='ADMIN')
        self.client.force_authenticate(self.user)
        self.sessions = {}
        for code in ('TESTA', 'TESTB'):
            self.sessions[code] = ExamSession.objects.create(id=f'{code}-2026', competition_id=code, code=code, name=code, parent=code, organizer='Test', time='2026–2027', sort_key=code,
                rounds=[{'id': 'round-1', 'name': 'Vòng 1', 'date': '2026-10-25'}])
            ExaminationSheet.objects.create(id=f'sheet-{code}', name=code, session_id=f'{code}-2026', url='https://docs.google.com/spreadsheets/d/test', sheet_tab=code, stage='session-output', created_at=timezone.now(), updated_at=timezone.now())
        self.options = {'partner': {'school': 'Trường A', 'representative': 'Người liên lạc', 'phone': '0912345678', 'email': 'school@example.test'}, 'academicYear': '2026-2027'}
        self.rows = [
            [1, 'Nguyễn Minh An', '12/07/2015', '001215012345', 'Lớp 6', 'TESTA', 250000, 'Nguyễn Văn A', '0901234567', 'parent@example.test', ''],
            [2, 'Nguyễn Minh An', '12/07/2015', '001215012345', 'Lớp 6', 'TESTB', 450000, 'Nguyễn Văn A', '0901234567', 'parent@example.test', ''],
            [3, 'Trần Minh Bình', '10/02/2014', '002214012345', 'Lớp 7', 'TESTA', 250000, 'Trần Văn A', '0907654321', 'parent2@example.test', ''],
        ]

    def workbook(self, rows=None, metadata=False, copy=False):
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.title = 'Đăng ký tham dự'
        if metadata:
            sheet.append(['Tên trường / đơn vị (*):', None, 'Trường A'])
            sheet.append(['Người phụ trách (*):', 'Người liên lạc'])
            sheet.append(['Số điện thoại (*):', '0912345678'])
            sheet.append(['Email nhận thông tin (*):', None, 'school@example.test'])
        sheet.append(['STT', 'Họ và tên thí sinh (*)', 'Ngày sinh (*)\n(DD/MM/YYYY)', 'CCCD / Hộ chiếu / SĐD Học sinh', 'Lớp đang học (*)', 'Cuộc thi đăng ký (*)\n(Chọn danh sách)', 'Lệ phí dự thi\n(Tự động tính)', 'Họ tên phụ huynh / Người giám hộ (*)', 'Số điện thoại (*)\n(Nhận Zalo/SMS)', 'Email liên hệ (*)', 'Ghi chú'])
        for row in self.rows if rows is None else rows:
            sheet.append(row)
        if copy:
            workbook.copy_worksheet(sheet).title = 'Bản sao danh sách'
        stream = io.BytesIO()
        workbook.save(stream)
        return stream.getvalue()

    def post(self, content, options):
        return self.client.post('/api/examination/import/school', {'file': SimpleUploadedFile('school.xlsx', content), 'options': json.dumps(options)}, format='multipart')

    def preview(self, content=None, options=None):
        content = content or self.workbook()
        response = self.post(content, options or self.options)
        self.assertEqual(response.status_code, 200, response.data)
        return response

    def commit(self, content=None, options=None):
        content = content or self.workbook()
        options = options or self.options
        preview = self.preview(content, options)
        self.assertTrue(preview.data['canCommit'], preview.data['issues'])
        with patch('examination.partner_contact_sync.launch_partner_contact_sync'):
            response = self.post(content, options | {'action': 'commit', 'previewToken': preview.data['previewToken']})
        self.assertEqual(response.status_code, 201, response.data)
        return response

    def test_import_multiple_subjects_once_groups_school_and_queues_sheets(self):
        preview = self.preview()
        self.assertEqual(preview.data['summary']['candidates'], 2)
        self.assertEqual(Candidate.objects.count(), 0)
        self.assertFalse(SystemConfig.objects.filter(key='examination_partners').exists())
        result = self.commit()
        self.assertEqual(result.data['summary']['newCandidates'], 2)
        self.assertEqual(result.data['summary']['newRegistrations'], 3)
        report = {item['competitionCode']: item for item in result.data['report']}
        self.assertEqual(report['TESTA']['registrations'], 2)
        self.assertEqual(report['TESTB']['registrations'], 1)
        self.assertEqual(Candidate.objects.count(), 2)
        self.assertEqual(CandidateParticipation.objects.count(), 3)
        self.assertEqual(SchoolRegistration.objects.count(), 2)
        self.assertEqual(ExaminationBillingRecord.objects.count(), 2)
        self.assertEqual(CandidateSheetOutbox.objects.count(), 2)
        self.assertEqual(SessionSheetOutbox.objects.count(), 3)
        self.client.force_authenticate(self.finance)
        records = self.client.get('/api/examination/billing/records?scope=all')
        self.assertEqual(len(records.data), 2)
        self.assertEqual({r['kind'] for r in records.data}, {'school'})
        self.assertEqual(sum(r['amount'] for r in records.data), 950000)
        self.assertEqual(self.client.get('/api/examination/billing/stats?scope=all').data['totalAmount'], 950000)

    def test_retry_and_exact_duplicate_do_not_double_bill(self):
        rows = self.rows + [self.rows[0][:]]
        rows[-1][0] = 4
        content = self.workbook(rows)
        self.commit(content)
        billing = ExaminationBillingRecord.objects.first()
        billing.transfer_status = 'confirmed'
        billing.invoice_number = 'HD-001'
        billing.save()
        self.commit(content)
        self.assertEqual(Candidate.objects.count(), 2)
        self.assertEqual(CandidateParticipation.objects.count(), 3)
        self.assertEqual(ExaminationBillingRecord.objects.count(), 2)
        billing.refresh_from_db()
        self.assertEqual(billing.transfer_status, 'confirmed')
        self.assertEqual(billing.invoice_number, 'HD-001')
        again = self.commit(content)
        self.assertEqual(again.data['summary']['newCandidates'], 0)
        self.assertEqual(again.data['summary']['existingCandidates'], 2)
        self.assertEqual(again.data['summary']['newRegistrations'], 0)
        self.assertEqual(again.data['summary']['existingRegistrations'], 3)

    def test_metadata_and_duplicate_tabs_use_one_selected_table(self):
        content = self.workbook(metadata=True, copy=True)
        raw, metadata, sheet, sheets = read_workbook(content)
        self.assertEqual(metadata['school'], 'Trường A')
        self.assertEqual(metadata['email'], 'school@example.test')
        self.assertEqual(len(raw), 3)
        self.assertEqual(sheet, 'Đăng ký tham dự')
        self.assertEqual(len(sheets), 2)
        self.commit(content, {'academicYear': '2026-2027'})

    def test_unknown_contest_and_invalid_date_block_all_writes(self):
        rows = [r[:] for r in self.rows]
        rows[0][5] = 'UNKNOWN'
        rows[1][2] = '31/02/2015'
        content = self.workbook(rows)
        preview = self.preview(content)
        self.assertFalse(preview.data['canCommit'])
        response = self.post(content, self.options | {'action': 'commit', 'previewToken': preview.data['previewToken']})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Candidate.objects.count(), 0)
        self.assertEqual(SchoolRegistration.objects.count(), 0)

    def test_ambiguous_sessions_require_mapping(self):
        original = self.sessions['TESTA']
        ExamSession.objects.create(id='TESTA-other', competition_id='TESTA', code='TESTA', name='Đợt khác', parent='TESTA', organizer='Test', time=original.time, sort_key='z', rounds=original.rounds)
        preview = self.preview()
        self.assertFalse(preview.data['canCommit'])
        self.commit(options=self.options | {'sessionMapping': {'TESTA': original.pk}})
        self.assertEqual(CandidateParticipation.objects.filter(session_id=original.pk).count(), 2)

    def test_stale_preview_and_tampered_file_are_rejected(self):
        content = self.workbook()
        preview = self.preview(content)
        self.sessions['TESTA'].note = 'Changed after preview'
        self.sessions['TESTA'].save()
        response = self.post(content, self.options | {'action': 'commit', 'previewToken': preview.data['previewToken']})
        self.assertEqual(response.status_code, 409)
        preview = self.preview(content)
        rows = [r[:] for r in self.rows]
        rows[0][6] = 999000
        response = self.post(self.workbook(rows), self.options | {'action': 'commit', 'previewToken': preview.data['previewToken']})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(Candidate.objects.count(), 0)

    def test_existing_school_contact_auto_fills_and_profile_is_reused(self):
        self.commit()
        partners = SystemConfig.objects.get(key='examination_partners').data['partners']
        self.assertEqual(len(partners), 1)
        response = self.preview(options={'partnerId': partners[0]['id'], 'academicYear': '2026-2027'})
        self.assertEqual(response.data['partner']['email'], 'school@example.test')
        self.assertEqual(response.data['summary']['newCandidates'], 0)

    def test_conflicting_duplicate_fees_block_commit(self):
        rows = self.rows + [self.rows[0][:]]
        rows[-1][6] = 999000
        preview = self.preview(self.workbook(rows))
        self.assertFalse(preview.data['canCommit'])

    def test_same_identity_with_different_names_in_file_is_not_duplicated(self):
        rows = [r[:] for r in self.rows]
        rows[1][1] = 'Nguyễn Minh Anh'
        preview = self.preview(self.workbook(rows))
        self.assertFalse(preview.data['canCommit'])
        self.assertTrue(any('Cùng giấy tờ' in issue['message'] for issue in preview.data['issues']))

    def test_reverse_sheet_sync_preserves_school_accounting_metadata(self):
        from .views import upsert_participation_history
        self.commit()
        participation = CandidateParticipation.objects.first()
        original = dict(participation.registration_data)
        upsert_participation_history(participation.candidate, participation.session_id, [], 'Sheet', {'generalNote': 'Updated from Sheet'})
        participation.refresh_from_db()
        self.assertEqual(participation.registration_data['schoolFee'], original['schoolFee'])
        self.assertEqual(participation.registration_data['schoolPartnerId'], original['schoolPartnerId'])
        self.assertTrue(self.preview().data['canCommit'])

    def test_shared_parent_contact_with_different_identity_requires_confirmation(self):
        Candidate.objects.create(id='EXISTING', code='EXISTING', name='Nguyễn Minh An', birth_date='2015-07-12', identity='009999012345', phone='0901234567', email='parent@example.test', school='Trường A', class_name='Lớp 6', sort_key='a')
        preview = self.preview()
        self.assertFalse(preview.data['canCommit'])
        options = self.options | {'candidateMatches': {'2': '__new__', '3': '__new__'}}
        self.commit(options=options)
        self.assertEqual(Candidate.objects.filter(name='Nguyễn Minh An').count(), 2)

    def test_settled_school_account_cannot_silently_add_new_fees(self):
        self.commit()
        billing = ExaminationBillingRecord.objects.get(school_registration__session=self.sessions['TESTA'])
        billing.transfer_status = 'confirmed'
        billing.save()
        rows = self.rows + [[4, 'Lê Minh Chi', '10/02/2014', '003214012345', 'Lớp 7', 'TESTA', 250000, 'Lê Văn A', '0907654322', 'parent3@example.test', '']]
        self.assertFalse(self.preview(self.workbook(rows)).data['canCommit'])

    def test_allocation_respects_existing_assignments_and_capacity(self):
        room = ExamRoom.objects.create(session=self.sessions['TESTA'], round_id='round-1', round_name='Vòng 1', common_name='Phòng', room_number='1', label='Phòng 1', mode='IN_PERSON', location='Trường A', capacity=1, allocation_strategy='CAPACITY')
        preview = self.preview()
        group = next(g for g in preview.data['groups'] if g['sessionId'] == self.sessions['TESTA'].pk)
        self.assertEqual(group['assigned'], 1)
        self.assertEqual(group['waiting'], 1)
        self.commit()
        self.assertEqual(RoundResult.objects.filter(exam_room=room).count(), 1)
        self.commit()
        self.assertEqual(RoundResult.objects.filter(exam_room=room).count(), 1)

    def test_transaction_rolls_back_candidate_partner_and_billing(self):
        content = self.workbook()
        preview = self.preview(content)
        with patch('examination.views.upsert_participation_history', side_effect=ValueError('Injected failure')):
            response = self.post(content, self.options | {'action': 'commit', 'previewToken': preview.data['previewToken']})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Candidate.objects.count(), 0)
        self.assertEqual(SchoolRegistration.objects.count(), 0)
        self.assertEqual(ExaminationBillingRecord.objects.count(), 0)
        self.assertEqual(CandidateSheetOutbox.objects.count(), 0)

    def test_finance_uploads_multiple_images_append_and_access_is_private(self):
        self.commit()
        billing = ExaminationBillingRecord.objects.first()
        png = lambda name: SimpleUploadedFile(name, b'\x89PNG\r\n\x1a\n' + b'x' * 20, content_type='image/png')
        endpoint = f'/api/examination/billing/records/{billing.pk}/proofs'
        self.assertEqual(self.client.post(endpoint, {'images': [png('1.png')]}, format='multipart').status_code, 403)
        self.client.force_authenticate(self.finance)
        response = self.client.post(endpoint, {'images': [png('1.png'), png('2.png')]}, format='multipart')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['proofs']), 2)
        self.client.post(endpoint, {'images': [png('3.png')]}, format='multipart')
        self.assertEqual(billing.proofs.count(), 3)
        self.assertEqual(set(billing.proofs.values_list('session_id', flat=True)), {billing.school_registration.session_id})
        invalid = self.client.post(endpoint, {'images': [png('4.png'), SimpleUploadedFile('invalid.png', b'not an image')]}, format='multipart')
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(billing.proofs.count(), 3)
        proof = billing.proofs.first()
        self.client.force_authenticate(None)
        self.assertNotEqual(self.client.get(f'/api/examination/billing/proofs/{proof.pk}/image').status_code, 200)

    def test_unmatched_images_wait_for_verified_contest(self):
        self.commit()
        self.client.force_authenticate(self.finance)
        png = lambda name: SimpleUploadedFile(name, b'\x89PNG\r\n\x1a\n' + b'x' * 20, content_type='image/png')
        response = self.client.post('/api/examination/billing/unmatched', {'amount': '250000', 'images': [png('1.png'), png('2.png')]}, format='multipart')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(response.data['proofs']), 2)
        self.assertTrue(all(p['sessionId'] is None for p in response.data['proofs']))
        participation = CandidateParticipation.objects.first()
        self.client.force_authenticate(self.user)
        resolved = self.client.post(f'/api/examination/billing/unmatched/{response.data["id"]}/resolve', {'candidateCode': participation.candidate.code, 'competitionCode': participation.session.code, 'resolutionNote': 'Đã xác minh'}, format='json')
        self.assertEqual(resolved.status_code, 200)
        self.assertEqual({p['sessionId'] for p in resolved.data['proofs']}, {participation.session_id})

    def test_drive_is_disabled_until_configured_then_routes_and_retries(self):
        self.commit()
        billing = ExaminationBillingRecord.objects.first()
        proof = TransferProof.objects.create(billing=billing, session=billing.school_registration.session, image=b'png', image_type='image/png', filename='proof.png', created_by='test')
        service = MagicMock()
        self.assertFalse(archive_pending(service=service)['enabled'])
        service.files.assert_not_called()
        config = SystemConfig.objects.create(key='examination_proof_drive', data={'enabled': True, 'competitionFolders': {proof.session.code: 'competition-folder'}, 'sessionFolders': {proof.session_id: 'session-folder'}})
        self.assertEqual(folder_for(proof.session), 'session-folder')
        service.files.return_value.list.return_value.execute.return_value = {'files': [{'id': 'existing-file'}]}
        self.assertEqual(archive_pending(service=service)['synced'], 1)
        proof.refresh_from_db()
        self.assertEqual(proof.drive_folder_id, 'session-folder')
        self.assertEqual(proof.drive_file_id, 'existing-file')
        service.files.return_value.create.assert_not_called()
        self.assertEqual(archive_pending(service=service)['synced'], 0)
