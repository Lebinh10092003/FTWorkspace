import uuid
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from authentication.models import Department, UserProfile
from .invigilation import export_pending
from .models import Candidate, ExamInvigilationAudit, ExamInvigilationShift, ExamSession, LogNote


class InvigilationTests(TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 11, 8, 45, tzinfo=ZoneInfo('Asia/Ho_Chi_Minh'))
        self.session, _ = ExamSession.objects.get_or_create(id='fimo-2026-2027', defaults={'code': 'FIMO', 'name': 'FIMO 2026–2027'})
        self.employee = UserProfile.objects.create(email='staff@example.com', name='Staff', access_modules=[])
        self.other = UserProfile.objects.create(email='other@example.com', name='Other', access_modules=[])
        self.admin = UserProfile.objects.create(email='admin@example.com', name='Admin', role='ADMIN')
        self.admin.department = Department.objects.get_or_create(name='Khảo thí')[0]; self.admin.save()
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

    def test_roster_rejects_unrelated_fields_and_invalid_attendance(self):
        self.assertEqual(self.client.patch(self.row_url(), {'revision': self.row['revision'], 'demo': False}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(self.row_url(), {'revision': self.row['revision'], 'attendance': 'invalid'}, format='json').status_code, 400)

    def test_saves_answer_without_calling_google_and_do_not_conflict_within_a_room(self):
        second = {**self.row, 'code': 'DEMO-002', 'revision': str(uuid.uuid4()), 'sheetRow': 5}
        self.shift.roster = [self.row, second]
        self.shift.sheet_url = 'https://docs.google.com/spreadsheets/d/demo/edit'
        self.shift.sheet_tab = 'Phòng 1'
        self.shift.save()
        with patch('examination.invigilation.sheet_service') as service, \
             patch('examination.invigilation.launch_candidate_sheet_worker') as launch:
            with self.captureOnCommitCallbacks(execute=True):
                first = self.client.patch(self.row_url(), {'revision': self.row['revision'], 'attendance': 'Có mặt'}, format='json')
            with self.captureOnCommitCallbacks(execute=True):
                other = self.client.patch(self.row_url().replace('DEMO-001', 'DEMO-002'), {'revision': second['revision'], 'attendance': 'Vắng'}, format='json')
        self.assertEqual((first.status_code, other.status_code), (200, 200))
        service.assert_not_called()
        self.assertEqual(launch.call_count, 2)
        self.shift.refresh_from_db()
        self.assertEqual(set(self.shift.pending_sheet_rows), {'DEMO-001', 'DEMO-002'})


    def test_only_khao_thi_staff_see_every_room(self):
        # An administrator of another department who invigilates sees only their room.
        tech = UserProfile.objects.create(email='tech@example.com', name='Tech', role='ADMIN')
        tech.department = Department.objects.get_or_create(name='Công nghệ')[0]; tech.save()
        other_room = ExamInvigilationShift.objects.create(session=self.session, occurrence_id='ca-1', round_name='Vòng loại Quốc gia',
            label='Ca 1', room_number='2', starts_at=self.now + timedelta(minutes=15), ends_at=self.now + timedelta(minutes=75))
        other_room.invigilators.add(tech)
        self.client.force_authenticate(tech)
        data = self.client.get('/api/examination/invigilation/shifts?sessionId=fimo-2026-2027').data
        self.assertEqual(([s['roomNumber'] for s in data['shifts']], data['canManage']), (['2'], False))
        self.assertEqual(self.client.get(f'/api/examination/invigilation/shifts/{self.shift.pk}').status_code, 404)
        self.client.force_authenticate(self.admin)
        data = self.client.get('/api/examination/invigilation/shifts?sessionId=fimo-2026-2027').data
        self.assertEqual((sorted(s['roomNumber'] for s in data['shifts']), data['canManage']), (['1', '2'], True))
        # Khảo thí listed among their departments (e.g. Mr Phong) opens every room.
        tech.departments.add(Department.objects.get_or_create(name='Khảo thí')[0])
        self.client.force_authenticate(tech)
        self.assertEqual(len(self.client.get('/api/examination/invigilation/shifts?sessionId=fimo-2026-2027').data['shifts']), 2)


class LiveRoomDutyTests(TestCase):
    """Real duties read candidates from the room allocation in Khảo thí."""

    def setUp(self):
        from .models import CandidateParticipation, ExamRoom, RoundResult
        tz = ZoneInfo('Asia/Ho_Chi_Minh')
        self.session = ExamSession.objects.create(id='live-fimo', code='FIMO', name='FIMO thật', rounds=[])
        self.room = ExamRoom.objects.create(session=self.session, round_id='round-national', occurrence_id='day-1',
            round_name='Vòng loại Quốc gia', common_name='Phòng', room_number='7', label='Phòng 7',
            mode=ExamRoom.MODE_ONLINE, exam_link='https://meet.example.com/p7')
        self.results = []
        for index, name in enumerate(['Nguyễn An', 'Trần Bình']):
            candidate = Candidate.objects.create(id=f'FT-9{index}', code=f'FT-9{index}', name=name, sort_key=name)
            participation = CandidateParticipation.objects.create(candidate=candidate, session=self.session)
            self.results.append(RoundResult.objects.create(participation=participation, round_id='round-national',
                round_name='Vòng loại Quốc gia', occurrence_id='day-1', exam_room=self.room, sbd=f'SBD{index}'))
        self.manager = UserProfile.objects.create(email='lead@example.com', name='Lead', role='ADMIN')
        self.manager.department = Department.objects.get_or_create(name='Khảo thí')[0]; self.manager.save()
        self.invigilator = UserProfile.objects.create(email='gt@example.com', name='Giám thị', access_modules=[])
        self.client = APIClient()
        self.client.force_authenticate(self.manager)
        response = self.client.post('/api/examination/invigilation/shifts', {
            'sessionId': self.session.pk, 'examRoomId': str(self.room.pk), 'label': 'Ca 1',
            'roundName': 'x', 'occurrenceId': 'x', 'roomNumber': 'x',
            'startsAt': datetime(2026, 10, 11, 9, tzinfo=tz).isoformat(), 'endsAt': datetime(2026, 10, 11, 10, tzinfo=tz).isoformat(),
            'invigilatorEmails': [self.invigilator.email]}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.shift_id = response.data['id']
        self.client.force_authenticate(self.invigilator)

    def roster(self):
        return self.client.get(f'/api/examination/invigilation/shifts/{self.shift_id}').data['roster']

    def test_duty_follows_the_room_and_lists_assigned_candidates(self):
        shift = ExamInvigilationShift.objects.get(pk=self.shift_id)
        self.assertEqual((shift.room_number, shift.occurrence_id, shift.room_link), ('7', 'day-1', 'https://meet.example.com/p7'))
        self.assertEqual([entry['sbd'] for entry in self.roster()], ['SBD0', 'SBD1'])
        # A later allocation change shows up without any re-import.
        self.results[1].exam_room = None
        self.results[1].save()
        self.assertEqual([entry['code'] for entry in self.roster()], ['FT-90'])

    def test_unmarked_candidates_become_absent_15_minutes_after_start(self):
        from .invigilation import auto_mark_absent
        tz = ZoneInfo('Asia/Ho_Chi_Minh')
        self.results[0].attendance = 'Có mặt'
        self.results[0].save()
        self.assertEqual(auto_mark_absent(datetime(2026, 10, 11, 9, 14, tzinfo=tz)), 0)
        self.assertEqual(auto_mark_absent(datetime(2026, 10, 11, 9, 15, tzinfo=tz)), 1)
        for result in self.results:
            result.refresh_from_db()
        self.assertEqual([r.attendance for r in self.results], ['Có mặt', 'Vắng'])
        entry = next(e for e in self.roster() if e['code'] == 'FT-91')
        self.assertEqual((entry['attendance'], entry['autoAbsent'], entry['updatedBy']), ('Vắng', True, 'Hệ thống'))
        # The invigilator can still mark a late arrival; nothing is redone afterwards.
        response = self.client.patch(f'/api/examination/invigilation/shifts/{self.shift_id}/roster/FT-91', {'revision': entry['revision'], 'attendance': 'Đến muộn'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(auto_mark_absent(datetime(2026, 10, 11, 9, 20, tzinfo=tz)), 0)
        # Shifts that already ended are never touched.
        self.results[0].attendance = ''
        self.results[0].save()
        self.assertEqual(auto_mark_absent(datetime(2026, 10, 11, 10, 1, tzinfo=tz)), 0)

    def test_profile_edits_show_in_the_room_at_once(self):
        # Email/SĐT changed in Khảo thí or on the Sheet appear for the invigilator without re-import.
        candidate = Candidate.objects.get(code='FT-90')
        candidate.email, candidate.phone, candidate.birth_date, candidate.class_name = 'moi@example.test', '0976626340', '2014-02-19', '7T5'
        candidate.save()
        entry = self.roster()[0]
        self.assertEqual((entry['email'], entry['phone'], entry['birthDate'], entry['className']), ('moi@example.test', '0976626340', '2014-02-19', '7T5'))

    def test_saving_writes_the_round_result_and_other_candidates_stay_editable(self):
        first, second = self.roster()
        url = f'/api/examination/invigilation/shifts/{self.shift_id}/roster/'
        response = self.client.patch(url + first['code'], {'revision': first['revision'], 'attendance': 'Có mặt', 'score': '18'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['entry']['updatedBy'], self.invigilator.email)
        # The second row was loaded before the first save and is still accepted.
        response = self.client.patch(url + second['code'], {'revision': second['revision'], 'attendance': 'Vắng'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.results[0].refresh_from_db()
        self.assertEqual((self.results[0].attendance, self.results[0].score), ('Có mặt', '18'))
        # Re-using the first row's old revision is rejected.
        self.assertEqual(self.client.patch(url + first['code'], {'revision': first['revision'], 'attendance': 'Vắng'}, format='json').status_code, 409)

    def test_marking_is_not_rejected_when_another_column_of_the_result_changed(self):
        # Reported 13/10/2026: marking one or several candidates showed an error,
        # because any other write to the result (Sheet import, score, automatic
        # absent marking) changed the whole-row revision.
        first = self.roster()[0]
        url = f"/api/examination/invigilation/shifts/{self.shift_id}/roster/{first['code']}"
        self.results[0].score = '15'
        self.results[0].save()
        response = self.client.patch(url, {'attendance': 'Có mặt', 'base': {'attendance': first['attendance']}}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        # Two quick clicks from the same screen: the second carries the value the first saved.
        response = self.client.patch(url, {'attendance': 'Đến muộn', 'base': {'attendance': 'Có mặt'}}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.results[0].refresh_from_db()
        self.assertEqual((self.results[0].attendance, self.results[0].score), ('Đến muộn', '15'))

    def test_real_conflict_returns_the_current_value_to_show(self):
        first = self.roster()[0]
        self.results[0].attendance = 'Vắng'
        self.results[0].save()
        ExamInvigilationAudit.objects.create(shift_id=self.shift_id, candidate_code=first['code'], actor=self.manager,
                                             before={}, after={'attendance': 'Vắng'})
        response = self.client.patch(f"/api/examination/invigilation/shifts/{self.shift_id}/roster/{first['code']}",
                                     {'attendance': 'Có mặt', 'base': {'attendance': first['attendance']}}, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['entry']['attendance'], 'Vắng')
        self.assertEqual(response.data['conflicts'], ['attendance'])

    def test_invigilator_can_override_the_automatic_absent_mark_from_an_old_screen(self):
        from .invigilation import auto_mark_absent
        first = self.roster()[0]
        auto_mark_absent(datetime(2026, 10, 11, 9, 16, tzinfo=ZoneInfo('Asia/Ho_Chi_Minh')))
        response = self.client.patch(f"/api/examination/invigilation/shifts/{self.shift_id}/roster/{first['code']}",
                                     {'attendance': 'Đến muộn', 'base': {'attendance': first['attendance']}}, format='json')
        self.assertEqual(response.status_code, 200, response.data)

    def test_attendance_goes_to_the_room_sheet_not_the_session_tab(self):
        from .models import ExaminationSheet, SessionSheetOutbox
        room_sheet = ExaminationSheet.objects.create(session_id=self.session.pk, stage='room-output', name='Phân phòng',
                                                     url='https://docs.google.com/spreadsheets/d/room/edit',
                                                     last_content_fingerprint='done', created_at=timezone.now(),
                                                     updated_at=timezone.now())
        ExaminationSheet.objects.create(id='live-fimo-tab', session_id=self.session.pk, stage='session-output', name='FT - FIMO',
                                        url='https://docs.google.com/spreadsheets/d/exam/edit', sheet_tab='FT - FIMO',
                                        created_at=timezone.now(), updated_at=timezone.now())
        SessionSheetOutbox.objects.all().delete()
        first = self.roster()[0]
        url = f"/api/examination/invigilation/shifts/{self.shift_id}/roster/{first['code']}"
        response = self.client.patch(url, {'attendance': 'Có mặt', 'base': {'attendance': first['attendance']}}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(SessionSheetOutbox.objects.exists())
        room_sheet.refresh_from_db()
        self.assertEqual(room_sheet.last_content_fingerprint, '')
        # A score still belongs to the session tab.
        response = self.client.patch(url, {'score': '18', 'base': {'score': ''}}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(SessionSheetOutbox.objects.exists())

    def test_session_tab_export_and_import_skip_attendance(self):
        from .sync import ROUND_HISTORY_FIELD_MAP
        self.assertNotIn('attendance', ROUND_HISTORY_FIELD_MAP)

    def test_room_from_another_session_is_rejected(self):
        self.client.force_authenticate(self.manager)
        other = ExamSession.objects.create(id='other-session', code='FIEO', name='FIEO', rounds=[])
        response = self.client.patch(f'/api/examination/invigilation/shifts/{self.shift_id}', {'examRoomId': str(self.room.pk)}, format='json')
        self.assertEqual(response.status_code, 200)
        foreign = self.room.__class__.objects.create(session=other, round_id='r', round_name='r', common_name='P', room_number='1', label='P1', mode='ONLINE')
        response = self.client.patch(f'/api/examination/invigilation/shifts/{self.shift_id}', {'examRoomId': str(foreign.pk)}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_assignment_and_time_change_notify_the_invigilator_once(self):
        from authentication.models import WorkspaceNotification
        notes = WorkspaceNotification.objects.filter(event_key__startswith='examination:duty:')
        self.assertEqual(notes.count(), 1)
        self.client.force_authenticate(self.manager)
        shift = ExamInvigilationShift.objects.get(pk=self.shift_id)
        self.client.patch(f'/api/examination/invigilation/shifts/{self.shift_id}', {'label': 'Ca 1'}, format='json')
        self.assertEqual(notes.count(), 1)
        self.client.patch(f'/api/examination/invigilation/shifts/{self.shift_id}', {
            'startsAt': (shift.starts_at + timedelta(minutes=30)).isoformat(), 'endsAt': (shift.ends_at + timedelta(minutes=30)).isoformat()}, format='json')
        self.assertEqual(notes.count(), 2)


class RoomsFromLinksAndGuestTests(TestCase):
    """FIEO 18/10/2026: rooms typed as Meet links in the session tab, external invigilators."""

    def setUp(self):
        from .models import CandidateParticipation, RoundResult
        self.session = ExamSession.objects.create(id='fieo-test', code='FIEO', name='FIEO 2026-2027', rounds=[{
            'id': 'r1', 'name': 'Vòng loại Quốc gia', 'slots': [
                {'id': 'd1', 'label': 'Đợt 1', 'date': '2026-10-18', 'time': '9:30-10:30'},
                {'id': 'd2', 'label': 'Đợt 2', 'date': '2026-12-13', 'time': '9:30-10:30'}]}])
        links = ['meet.google.com/zzz-bbb-ccc', 'https://meet.google.com/aaa-bbb-ccc', 'meet.google.com/zzz-bbb-ccc/', 'meet.google.com/aaa-bbb-ccc']
        sbds = ['150010', '130001', '150011', '130002']
        self.results = []
        for index, (link, sbd) in enumerate(zip(links, sbds)):
            candidate = Candidate.objects.create(id=f'FT-L{index}', code=f'FT-L{index}', name=f'Thí sinh {index}', sort_key=str(index),
                                                 phone=f'09000000{index}', email=f'ts{index}@example.com')
            participation = CandidateParticipation.objects.create(candidate=candidate, session=self.session)
            self.results.append(RoundResult.objects.create(
                participation=participation, round_id='r1', round_name='Vòng loại Quốc gia',
                occurrence_id='d1' if index != 3 else '',  # one row without a date on the Sheet
                exam_date='2026-10-18' if index != 3 else '', time_slot='9:30-10:30', sbd=sbd,
                location=link, link=f'quilgo-{index}'))
        self.manager = UserProfile.objects.create(email='lead@example.com', name='Lead', role='ADMIN')
        self.manager.department = Department.objects.get_or_create(name='Khảo thí')[0]
        self.manager.save()
        self.client = APIClient()
        self.client.force_authenticate(self.manager)
        self.url = f'/api/examination/sessions/{self.session.pk}/rooms-from-links'

    def test_preview_groups_links_orders_rooms_by_sbd_and_writes_nothing(self):
        from .models import ExamRoom
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200, response.data)
        plan = response.data['plans'][0]
        self.assertEqual((plan['occurrenceId'], plan['startsAt']), ('d1', '2026-10-18T09:30:00+07:00'))
        self.assertEqual([(r['label'], r['candidates'], r['firstSbd']) for r in plan['rooms']],
                         [('Phòng 1', 2, '130001'), ('Phòng 2', 2, '150010')])
        self.assertEqual(plan['rooms'][0]['missingDate'], 1)
        self.assertFalse(ExamRoom.objects.exists())

    def test_apply_seats_candidates_creates_duties_and_keeps_every_other_field(self):
        response = self.client.post(self.url, {'plans': [{'roundId': 'r1', 'occurrenceId': 'd1'}]}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual((response.data['roomsCreated'], response.data['seated'], response.data['shiftsCreated']), (2, 4, 2))
        for result in self.results:
            before = (result.location, result.link, result.exam_date, result.sbd, result.occurrence_id)
            result.refresh_from_db()
            self.assertIsNotNone(result.exam_room_id)
            self.assertEqual((result.location, result.link, result.exam_date, result.sbd, result.occurrence_id), before)
        shift = ExamInvigilationShift.objects.get(room_number='1')
        self.assertEqual((shift.room_link, len(shift.guest_token) >= 24), ('https://meet.google.com/aaa-bbb-ccc', True))
        # Running it again changes nothing.
        again = self.client.post(self.url, {'plans': [{'roundId': 'r1', 'occurrenceId': 'd1'}]}, format='json')
        self.assertEqual((again.data['roomsCreated'], again.data['seated'], again.data['shiftsCreated']), (0, 0, 0))
        # The preview then reports every room as done, so the screen offers nothing to create.
        rooms = self.client.get(self.url).data['plans'][0]['rooms']
        self.assertTrue(all(r['existingRoomId'] and r['hasShift'] and r['alreadySeated'] == r['candidates'] for r in rooms))

    def _guest_room(self, email=''):
        self.client.post(self.url, {'plans': [{'roundId': 'r1', 'occurrenceId': 'd1'}]}, format='json')
        shift = ExamInvigilationShift.objects.get(room_number='1')
        if email:
            response = self.client.patch(f'/api/examination/invigilation/shifts/{shift.pk}',
                                         {'guestName': 'Lê Thu Hà', 'guestEmail': email}, format='json')
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data['guestEmail'], email)
            shift.refresh_from_db()
        return shift

    def test_guest_link_needs_the_assigned_email_and_saves_under_that_name(self):
        shift = self._guest_room('lethuha04102005@gmail.com')
        guest = APIClient()
        url = f'/api/public/invigilation/{shift.guest_token}'
        with patch('django.utils.timezone.now', return_value=shift.starts_at):
            self.assertEqual(guest.get(url).status_code, 401)
            wrong = guest.get(url, HTTP_X_GUEST_EMAIL='khac@gmail.com')
            self.assertEqual((wrong.status_code, wrong.data['needEmail']), (401, True))
            ok = guest.get(url, HTTP_X_GUEST_EMAIL='LeThuHa04102005@gmail.com ')
            self.assertEqual(ok.status_code, 200, ok.data)
            entry = ok.data['shift']['roster'][0]
            self.assertTrue(entry['phone'] and entry['email'])  # full candidate details, as decided
            self.assertNotIn('guestUrl', ok.data['shift'])
            saved = guest.patch(f"{url}/roster/{entry['code']}",
                                {'attendance': 'Có mặt', 'base': {'attendance': entry['attendance']}}, format='json',
                                HTTP_X_GUEST_EMAIL='lethuha04102005@gmail.com')
            self.assertEqual(saved.status_code, 200, saved.data)
            self.assertEqual(saved.data['entry']['updatedBy'], 'Lê Thu Hà (giám thị ngoài)')
            self.assertFalse(saved.data['entry']['autoAbsent'])

    def test_guest_link_only_opens_around_the_duty_and_can_be_revoked(self):
        shift = self._guest_room()
        guest = APIClient()
        url = f'/api/public/invigilation/{shift.guest_token}'
        with patch('django.utils.timezone.now', return_value=shift.starts_at - timedelta(hours=25)):
            self.assertEqual(guest.get(url).status_code, 403)
        with patch('django.utils.timezone.now', return_value=shift.ends_at + timedelta(hours=13)):
            self.assertEqual(guest.get(url).status_code, 403)
        with patch('django.utils.timezone.now', return_value=shift.starts_at):
            self.assertEqual(guest.get(url).status_code, 200)
            self.client.post(f'/api/examination/invigilation/shifts/{shift.pk}/guest-link', {'action': 'revoke'}, format='json')
            self.assertEqual(guest.get(url).status_code, 404)
        self.assertEqual(guest.get('/api/public/invigilation/short').status_code, 404)

    def test_only_khao_thi_managers_create_rooms(self):
        outsider = UserProfile.objects.create(email='nv@example.com', name='NV', access_modules=[])
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get(self.url).status_code, 403)


class InvigilatorMailAndRoomSheetTests(TestCase):
    """Duty details e-mailed to invigilators; the room output Sheet attached from Coi thi."""

    def setUp(self):
        RoomsFromLinksAndGuestTests.setUp(self)
        self.client.post(self.url, {'plans': [{'roundId': 'r1', 'occurrenceId': 'd1'}]}, format='json')
        self.shift = ExamInvigilationShift.objects.get(room_number='1')
        self.client.patch(f'/api/examination/invigilation/shifts/{self.shift.pk}',
                          {'guestName': 'Lê Thu Hà', 'guestEmail': 'lethuha04102005@gmail.com'}, format='json')
        self.shift.refresh_from_db()
        self.notify = f'/api/examination/invigilation/notify?sessionId={self.session.pk}'

    def test_list_shows_recipients_and_a_prefilled_gmail_draft(self):
        response = self.client.get(self.notify)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['mailConfigured'])
        item = next(i for i in response.data['items'] if i['shiftId'] == str(self.shift.pk))
        person = item['recipients'][0]
        self.assertEqual((person['email'], person['kind']), ('lethuha04102005@gmail.com', 'guest'))
        self.assertIn('mail.google.com', person['gmailUrl'])
        self.assertIn(self.shift.guest_token, person['gmailUrl'])
        self.assertIn('Mở trang điểm danh', item['previewHtml'])
        # Sending without an outgoing account is refused, never half done.
        refused = self.client.post('/api/examination/invigilation/notify', {'sessionId': self.session.pk, 'shiftIds': [str(self.shift.pk)]}, format='json')
        self.assertEqual(refused.status_code, 400)

    @override_settings(EMAIL_HOST='smtp.example.com', EMAIL_HOST_USER='khaothi@fermat.vn',
                       EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_send_mails_buttons_to_the_attendance_page_and_the_meet_room(self):
        from django.core import mail
        response = self.client.post('/api/examination/invigilation/notify', {'sessionId': self.session.pk, 'shiftIds': [str(self.shift.pk)]}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ['lethuha04102005@gmail.com'])
        html = message.alternatives[0][0]
        self.assertIn(f'/coi-thi/{self.shift.guest_token}', html)
        self.assertIn('https://meet.google.com/aaa-bbb-ccc', html)
        self.shift.refresh_from_db()
        self.assertIsNotNone(self.shift.notified_at)

    def test_room_sheet_can_be_attached_from_coi_thi(self):
        url = f'/api/examination/invigilation/room-sheet?sessionId={self.session.pk}'
        self.assertEqual(self.client.get(url).data['url'], '')
        self.assertEqual(self.client.post(url, {'url': 'khong-phai-link'}, format='json').status_code, 400)
        saved = self.client.post(url, {'url': 'https://docs.google.com/spreadsheets/d/abc123XYZ/edit'}, format='json')
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual((saved.data['url'], saved.data['pending']), ('https://docs.google.com/spreadsheets/d/abc123XYZ/edit', True))

    def test_invitation_follows_the_approved_template_from_session_data(self):
        from .invigilation_mail import compose
        from .models import Competition
        Competition.objects.create(id='fieo-c', code='FIEO', name='FermatTech International English Olympiad', parent='FT', organizer='FermatTech', sort_key='fieo')
        self.session.competition_id = 'fieo-c'
        self.session.save()
        self.shift.refresh_from_db()
        person = {'name': 'Lê Thu Hà', 'email': 'lethuha04102005@gmail.com', 'kind': 'guest', 'url': 'https://workspace.fermat.vn/coi-thi/x'}
        message = compose(self.shift, person, 27)
        self.assertEqual(message['subject'], '[FermatTech] Thư mời coi thi FIEO 2026–2027 – Vòng loại Quốc gia, đợt 1 – Ngày 18/10/2026')
        text = message['text']
        for expected in ('Kính gửi Lê Thu Hà,', 'Kỳ thi FermatTech International English Olympiad (FIEO) năm học 2026–2027',
                         '09:30 – 10:30, Chủ nhật, ngày 18/10/2026', 'Trực tuyến qua Google Meet', 'trước 09:00', 'Sau 09:45',
                         'trước 20:00 ngày 17/10/2026', 'chỉ mở được bằng địa chỉ email nhận thư này'):
            self.assertIn(expected, text)
        staff = compose(self.shift, {**person, 'kind': 'staff'}, 27)['text']
        self.assertIn('tài khoản FT Workspace', staff)
        self.assertNotIn('chỉ mở được bằng địa chỉ email', staff)

