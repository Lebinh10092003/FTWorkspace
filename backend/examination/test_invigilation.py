import uuid
from datetime import datetime, timedelta
from io import StringIO
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from authentication.models import UserProfile
from .invigilation import export_pending
from .models import Candidate, ExamInvigilationAudit, ExamInvigilationShift, ExamSession, LogNote


class InvigilationTests(TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 11, 8, 45, tzinfo=ZoneInfo('Asia/Ho_Chi_Minh'))
        self.session, _ = ExamSession.objects.get_or_create(id='fimo-2026-2027', defaults={'code': 'FIMO', 'name': 'FIMO 2026–2027'})
        self.employee = UserProfile.objects.create(email='staff@example.com', name='Staff', access_modules=[])
        self.other = UserProfile.objects.create(email='other@example.com', name='Other', access_modules=[])
        self.admin = UserProfile.objects.create(email='admin@example.com', name='Admin', role='ADMIN')
        self.row = {'code': 'DEMO-001', 'name': 'Thí sinh demo 001', 'revision': str(uuid.uuid4()),
                    'attendance': 'Chưa điểm danh', 'score': '', 'note': '', 'sheetRow': 4,
                    'sheetSnapshot': ['Chưa điểm danh', '', '']}
        self.shift = ExamInvigilationShift.objects.create(session=self.session, occurrence_id='ca-1',
            round_name='Vòng loại Quốc gia', label='Ca 1', room_number='1', starts_at=self.now + timedelta(minutes=15),
            ends_at=self.now + timedelta(minutes=75), roster=[self.row], demo=True)
        self.shift.invigilators.add(self.employee)
        self.client = APIClient()
        self.client.force_authenticate(self.employee)

    def row_url(self, shift=None):
        return f'/api/examination/invigilation/shifts/{(shift or self.shift).pk}/roster/DEMO-001'

    def test_employee_without_examination_module_can_access_own_duties(self):
        with patch('examination.invigilation.timezone.now', return_value=self.now):
            response = self.client.get('/api/examination/invigilation/my-shifts')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['shifts']), 1)
        self.assertNotIn('roster', response.data['shifts'][0])
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertEqual(datetime.fromisoformat(response.data['shifts'][0]['remindAt']), self.now)

    def test_admin_does_not_receive_other_employees_popup(self):
        self.client.force_authenticate(self.admin)
        with patch('examination.invigilation.timezone.now', return_value=self.now):
            self.assertEqual(self.client.get('/api/examination/invigilation/my-shifts').data['shifts'], [])

    def test_other_employee_cannot_read_or_change_room(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f'/api/examination/invigilation/shifts/{self.shift.pk}').status_code, 404)
        self.assertEqual(self.client.patch(self.row_url(), {'revision': self.row['revision'], 'attendance': 'Có mặt'}, format='json').status_code, 404)

    def test_employee_can_save_attendance_and_zero_score_with_audit(self):
        response = self.client.patch(self.row_url(), {'revision': self.row['revision'], 'attendance': 'Có mặt', 'score': 0}, format='json')
        self.assertEqual(response.status_code, 200)
        self.shift.refresh_from_db()
        self.assertEqual(self.shift.roster[0]['score'], '0')
        self.assertEqual(self.shift.roster[0]['attendance'], 'Có mặt')
        self.assertEqual(ExamInvigilationAudit.objects.get().actor, self.employee)
        self.assertEqual(Candidate.objects.count(), 0)

    def test_stale_revision_cannot_overwrite_another_invigilator(self):
        payload = {'revision': self.row['revision'], 'attendance': 'Có mặt'}
        self.assertEqual(self.client.patch(self.row_url(), payload, format='json').status_code, 200)
        payload['attendance'] = 'Vắng'
        self.assertEqual(self.client.patch(self.row_url(), payload, format='json').status_code, 409)
        self.shift.refresh_from_db()
        self.assertEqual(self.shift.roster[0]['attendance'], 'Có mặt')
        self.assertEqual(ExamInvigilationAudit.objects.count(), 1)

    def test_failed_google_write_is_durable_and_retriable(self):
        self.shift.sheet_url = 'https://docs.google.com/spreadsheets/d/' + 'a'*24 + '/edit'
        self.shift.sheet_tab = 'Phòng 1'
        self.shift.save()
        with patch('examination.invigilation.sheet_service', side_effect=RuntimeError('offline')):
            response = self.client.patch(self.row_url(), {'revision': self.row['revision'], 'attendance': 'Đến muộn'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['pendingSheet'])
        self.shift.refresh_from_db()
        self.assertEqual(self.shift.roster[0]['attendance'], 'Đến muộn')
        self.assertIn('DEMO-001', self.shift.pending_sheet_rows)

    def test_room_sheet_is_one_way_web_authoritative_and_only_identity_is_read(self):
        self.shift.sheet_url = 'a'*24
        self.shift.sheet_tab = 'Phòng 1'
        self.shift.pending_sheet_rows = {'DEMO-001': self.row['revision']}
        self.shift.roster[0]['attendance'] = 'Có mặt'
        self.shift.save()
        service = MagicMock()
        service.spreadsheets.return_value.values.return_value.get.return_value.execute.return_value = {
            'values': [['DEMO-001']]}
        with patch('examination.invigilation.sheet_service', return_value=service):
            self.assertTrue(export_pending(self.shift))
        service.spreadsheets.return_value.values.return_value.get.assert_called_once_with(
            spreadsheetId='a'*24, range="'Phòng 1'!G4")
        values = service.spreadsheets.return_value.values.return_value.batchUpdate.call_args.kwargs['body']['data'][0]['values']
        self.assertEqual(values, [['Có mặt', '', '']])
        self.shift.refresh_from_db()
        self.assertEqual(self.shift.pending_sheet_rows, {})

    def test_one_wrong_sheet_row_cannot_block_other_rows(self):
        second = {**self.row, 'code': 'DEMO-002', 'sheetRow': 5, 'revision': str(uuid.uuid4()), 'score': '0'}
        self.shift.sheet_url, self.shift.sheet_tab = 'a'*24, 'Phòng 1'
        self.shift.roster = [self.row, second]
        self.shift.pending_sheet_rows = {e['code']: e['revision'] for e in self.shift.roster}
        self.shift.save()
        service = MagicMock()
        service.spreadsheets.return_value.values.return_value.get.return_value.execute.side_effect = [
            {'values': [['WRONG']]}, {'values': [['DEMO-002']]}]
        with patch('examination.invigilation.sheet_service', return_value=service):
            self.assertFalse(export_pending(self.shift))
        self.shift.refresh_from_db()
        self.assertEqual(self.shift.pending_sheet_rows, {'DEMO-001': self.row['revision']})
        write = service.spreadsheets.return_value.values.return_value.batchUpdate.call_args.kwargs['body']['data'][0]
        self.assertEqual(write['range'], "'Phòng 1'!L5:N5")
        self.assertEqual(write['values'][0][2], 0)
        self.assertIn('DEMO-001', LogNote.objects.get().content)

    def test_new_edit_during_google_write_remains_queued(self):
        self.shift.sheet_url, self.shift.sheet_tab = 'a'*24, 'Phòng 1'
        self.shift.pending_sheet_rows = {'DEMO-001': self.row['revision']}
        self.shift.save()
        new_revision = str(uuid.uuid4())
        service = MagicMock()
        service.spreadsheets.return_value.values.return_value.get.return_value.execute.return_value = {'values': [['DEMO-001']]}
        def concurrent_edit():
            ExamInvigilationShift.objects.filter(pk=self.shift.pk).update(
                revision=uuid.uuid4(), roster=[{**self.row, 'revision': new_revision, 'attendance': 'Đến muộn'}],
                pending_sheet_rows={'DEMO-001': new_revision})
            return {}
        service.spreadsheets.return_value.values.return_value.batchUpdate.return_value.execute.side_effect = concurrent_edit
        with patch('examination.invigilation.sheet_service', return_value=service):
            self.assertFalse(export_pending(self.shift))
        self.shift.refresh_from_db()
        self.assertEqual(self.shift.pending_sheet_rows['DEMO-001'], new_revision)
        self.assertEqual(self.shift.roster[0]['attendance'], 'Đến muộn')

    def test_wrong_sbd_at_sheet_row_is_never_modified(self):
        self.shift.sheet_url = 'a'*24
        self.shift.pending_sheet_rows = {'DEMO-001': self.row['revision']}
        self.shift.save()
        service = MagicMock()
        service.spreadsheets.return_value.values.return_value.get.return_value.execute.return_value = {'values': [['OTHER']]}
        with patch('examination.invigilation.sheet_service', return_value=service):
            self.assertFalse(export_pending(self.shift))
        service.spreadsheets.return_value.values.return_value.batchUpdate.assert_not_called()

    def test_employee_cannot_change_schedule_or_assignment(self):
        response = self.client.patch(f'/api/examination/invigilation/shifts/{self.shift.pk}', {'invigilatorEmails': [self.other.email]}, format='json')
        self.assertEqual(response.status_code, 403)

    def test_invalid_schedule_and_unknown_staff_rejected(self):
        self.client.force_authenticate(self.admin)
        url = f'/api/examination/invigilation/shifts/{self.shift.pk}'
        self.assertEqual(self.client.patch(url, {'endsAt': '2026-10-11T08:00:00+07:00'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, {'startsAt': '2026-10-11T09:00:00'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, {'invigilatorEmails': ['unknown@example.com']}, format='json').status_code, 400)

    def test_revoked_or_inactive_employee_receives_no_reminder(self):
        self.employee.employment_status = 'LEFT'; self.employee.save()
        with patch('examination.invigilation.timezone.now', return_value=self.now):
            self.assertEqual(self.client.get('/api/examination/invigilation/my-shifts').data['shifts'], [])
        self.assertEqual(self.client.get(f'/api/examination/invigilation/shifts/{self.shift.pk}').status_code, 404)

    def test_second_shift_survives_end_of_first_and_disabled_shifts_disappear(self):
        second = ExamInvigilationShift.objects.create(session=self.session, occurrence_id='ca-2', round_name='Vòng loại',
            label='Ca 2', room_number='1', starts_at=self.now + timedelta(minutes=105), ends_at=self.now + timedelta(minutes=165))
        second.invigilators.add(self.employee)
        with patch('examination.invigilation.timezone.now', return_value=self.now + timedelta(minutes=75)):
            data = self.client.get('/api/examination/invigilation/my-shifts').data['shifts']
            self.assertEqual([s['id'] for s in data], [str(second.pk)])
        second.enabled = False; second.save()
        with patch('examination.invigilation.timezone.now', return_value=self.now + timedelta(minutes=75)):
            self.assertEqual(self.client.get('/api/examination/invigilation/my-shifts').data['shifts'], [])

    def test_demo_seed_is_idempotent_and_keeps_operator_edits(self):
        for email in ['tienthm@fermat.edu.vn', 'phuongnt@fermat.edu.vn', 'binhlv@fermat.edu.vn', 'phongnt@fermat.edu.vn']:
            UserProfile.objects.get_or_create(email=email, defaults={'name': email})
        call_command('setup_exam_invigilation_demo', apply=True, stdout=StringIO())
        seeded = ExamInvigilationShift.objects.get(session=self.session, occurrence_id='vlqg-2026-10-11-ca-1', room_number='1')
        self.assertEqual(seeded.invigilators.get().email, 'tienthm@fermat.edu.vn')
        seeded.roster[0]['name'] = 'Operator edit'; seeded.save()
        call_command('setup_exam_invigilation_demo', apply=True, stdout=StringIO())
        seeded.refresh_from_db()
        self.assertEqual(seeded.roster[0]['name'], 'Operator edit')
        self.assertEqual(ExamInvigilationShift.objects.filter(occurrence_id__startswith='vlqg-').count(), 8)
        self.assertEqual(Candidate.objects.count(), 0)

    def test_roster_rejects_unrelated_fields_and_invalid_attendance(self):
        self.assertEqual(self.client.patch(self.row_url(), {'revision': self.row['revision'], 'demo': False}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(self.row_url(), {'revision': self.row['revision'], 'attendance': 'invalid'}, format='json').status_code, 400)
