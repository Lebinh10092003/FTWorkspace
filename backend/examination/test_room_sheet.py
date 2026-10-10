"""Room output Sheet: one tab per room, web -> Sheet only."""
from unittest.mock import MagicMock, patch

from django.test import TestCase
from django.utils import timezone

from authentication.models import UserProfile
from .models import (Candidate, CandidateParticipation, ExamInvigilationShift, ExamRoom, ExamSession, ExaminationSheet,
                     RoundResult)
from .room_sheet import HEADER, export_room_sheet, room_tabs


class RoomSheetTests(TestCase):
    def setUp(self):
        self.session = ExamSession.objects.create(id='fimo-r', competition_id='FIMO', code='FIMO', name='FIMO', parent='FT', organizer='FT',
            time='2026-2027', sort_key='1', rounds=[{'id': 'round-national', 'name': 'Vòng loại Quốc gia', 'slots': [
                {'id': 'ca-1', 'date': '2026-10-11', 'time': '09:00-10:00', 'label': 'Ca 1'},
                {'id': 'ca-2', 'date': '2026-10-11', 'time': '10:30-11:30', 'label': 'Ca 2'}]}])
        self.rooms = {}
        for occurrence in ('ca-2', 'ca-1'):
            self.rooms[occurrence] = ExamRoom.objects.create(session=self.session, round_id='round-national', occurrence_id=occurrence,
                round_name='Vòng loại Quốc gia', common_name='Room', room_number='1', label='Room 1', mode=ExamRoom.MODE_ONLINE,
                link='https://meet.google.com/aju-tvvv-kik')
        for index, (occurrence, name) in enumerate([('ca-1', 'Trần Bình'), ('ca-1', 'Lê An'), ('ca-2', 'Phạm Cường')]):
            candidate = Candidate.objects.create(id=f'FT-R{index}', code=f'FT-R{index}', name=name, birth_date='2014-02-19', class_name='7T5',
                school='THCS Cầu Giấy B', phone='0976626340', email=f'r{index}@example.test', parent='Phụ huynh', sort_key=name)
            participation = CandidateParticipation.objects.create(candidate=candidate, session=self.session)
            RoundResult.objects.create(participation=participation, round_id='round-national', round_name='Vòng loại Quốc gia',
                occurrence_id=occurrence, exam_room=self.rooms[occurrence], sbd=f'14000{index}', exam_date='2026-10-11',
                time_slot='9:00-10:00' if occurrence == 'ca-1' else '10:30-11:30', attendance='Có mặt' if index == 0 else '')
        shift = ExamInvigilationShift.objects.create(session=self.session, exam_room=self.rooms['ca-1'], occurrence_id='x', round_name='x',
            label='Ca 1', room_number='1', starts_at=timezone.now(), ends_at=timezone.now() + timezone.timedelta(hours=1))
        shift.invigilators.add(UserProfile.objects.create(email='tien@example.test', name='Trần Hoàng Minh Tiến'))
        ExaminationSheet.objects.create(id='room-out', name='Phân phòng', url='https://docs.google.com/spreadsheets/d/roomfile/edit',
            session_id=self.session.pk, stage='room-output', created_at=timezone.now(), updated_at=timezone.now())

    def test_tabs_follow_batch_order_with_room_details_and_contacts(self):
        tabs = room_tabs(self.session)
        self.assertEqual([title for title, _ in tabs], ['Danh sách phòng', 'Ca 1 - Room 1', 'Ca 2 - Room 1'])
        self.assertEqual(tabs[0][1][3], ['Ca 1', '11/10/2026', '9:00-10:00', 'Room 1', 'https://meet.google.com/aju-tvvv-kik', 'Trần Hoàng Minh Tiến', 2, 'Ca 1 - Room 1'])
        values = tabs[1][1]
        self.assertEqual(values[0][0], 'FIMO · Vòng loại Quốc gia · Ca 1 (9:00-10:00) · 11/10/2026')
        self.assertEqual(values[1], ['Phòng: Room 1', 'https://meet.google.com/aju-tvvv-kik'])
        self.assertEqual(values[2][0], 'Giám thị: Trần Hoàng Minh Tiến')
        self.assertEqual(values[5], HEADER)
        self.assertEqual(values[6], [1, '140000', 'FT-R0', 'Trần Bình', '19/02/2014', '7T5', 'THCS Cầu Giấy B', '0976626340',
                                     'r0@example.test', 'Phụ huynh', 'Có mặt', ''])
        self.assertEqual(values[7][10], 'Chưa điểm danh')

    @patch('examination.invigilation.sheet_service')
    def test_export_creates_tabs_removes_gone_rooms_and_skips_when_unchanged(self, build):
        service = build.return_value
        service.spreadsheets().get().execute.return_value = {'sheets': [
            {'properties': {'title': 'Trang tính1', 'sheetId': 0}}, {'properties': {'title': 'Ca 3 - Room 9', 'sheetId': 9}}]}
        service.spreadsheets().values().get().execute.side_effect = lambda **_: {'values': [HEADER]}
        service.spreadsheets().values().get.side_effect = None
        def read(spreadsheetId, range):
            response = MagicMock()
            response.execute.return_value = {'values': [HEADER]} if 'Room 9' in range else {'values': []}
            return response
        service.spreadsheets().values().get = read
        service.spreadsheets().batchUpdate().execute.return_value = {'replies': [
            {'addSheet': {'properties': {'title': 'Danh sách phòng', 'sheetId': 10}}}, {'addSheet': {'properties': {'title': 'Ca 1 - Room 1', 'sheetId': 11}}}, {'addSheet': {'properties': {'title': 'Ca 2 - Room 1', 'sheetId': 12}}}]}
        result = export_room_sheet(self.session.pk)
        self.assertEqual(result, {'tabs': 3, 'created': 3, 'removed': 1})
        requests = service.spreadsheets().batchUpdate.call_args_list[-2].kwargs['body']['requests']
        self.assertIn({'deleteSheet': {'sheetId': 9}}, requests)
        data = service.spreadsheets().values().batchUpdate.call_args.kwargs['body']['data']
        self.assertEqual([item['range'] for item in data], ["'Danh sách phòng'!A1:L5", "'Ca 1 - Room 1'!A1:L8", "'Ca 2 - Room 1'!A1:L7"])
        service.spreadsheets().values().batchUpdate.reset_mock()
        self.assertEqual(export_room_sheet(self.session.pk), {'tabs': 3, 'unchanged': True})
        service.spreadsheets().values().batchUpdate.assert_not_called()
        # A change in Khảo thí (new email) is written again.
        Candidate.objects.filter(code='FT-R1').update(email='moi@example.test')
        self.assertEqual(export_room_sheet(self.session.pk)['tabs'], 3)
        service.spreadsheets().values().batchUpdate.assert_called()
