"""Nhập lại từ Sheet không được xóa dữ liệu đăng ký chỉ có trên web (chứng từ thanh toán, mã đăng ký)."""
from django.test import TestCase

from .models import Candidate, CandidateParticipation, ExamSession
from .sync import merge_registration_data

WEB_ONLY = {
    'publicRegistrationId': '42',
    'paymentProof': 'Workspace #42',
    'formTab': 'Form 1',
    'subject': 'Toán',
}
SHEET_ROW = {
    'subject': '', 'category': 'Bảng A', 'registrationMethod': '', 'registrationUnit': '',
    'teamName': '', 'examLanguage': '', 'generalNote': 'Đã gọi xác nhận', 'certificateLink': '',
}


class RegistrationDataMergeTests(TestCase):
    def setUp(self):
        self.session = ExamSession.objects.create(
            id='merge', competition_id='FIMO', code='FIMO', name='FIMO 2026-2027', parent='FT',
            organizer='FT', time='2026-2027', sort_key='1', rounds=[{'id': 'r1', 'name': 'Vòng 1'}],
        )
        self.candidate = Candidate.objects.create(id='merge-1', code='FT-91000', name='Trần Bình', sort_key='1')
        self.participation = CandidateParticipation.objects.create(
            candidate=self.candidate, session=self.session, registration_data=dict(WEB_ONLY),
        )

    def test_helper_keeps_existing_keys_and_ignores_blank_cells(self):
        merged = merge_registration_data(WEB_ONLY, SHEET_ROW)
        self.assertEqual(merged['paymentProof'], 'Workspace #42')
        self.assertEqual(merged['subject'], 'Toán')  # ô trống trên Sheet không xóa
        self.assertEqual(merged['category'], 'Bảng A')
        self.assertEqual(merged['generalNote'], 'Đã gọi xác nhận')

    def test_helper_can_clear_keys_the_user_emptied_on_web(self):
        merged = merge_registration_data(WEB_ONLY, {'subject': ''}, clear_empty=True)
        self.assertNotIn('subject', merged)
        self.assertEqual(merged['paymentProof'], 'Workspace #42')

    def test_sheet_scan_import_keeps_payment_proof(self):
        from .sync import upsert_participation_history
        upsert_participation_history(self.candidate, self.session.pk, [], 'Sheet', SHEET_ROW)
        data = CandidateParticipation.objects.get(pk=self.participation.pk).registration_data
        self.assertEqual(data['paymentProof'], 'Workspace #42')
        self.assertEqual(data['publicRegistrationId'], '42')
        self.assertEqual(data['subject'], 'Toán')
        self.assertEqual(data['generalNote'], 'Đã gọi xác nhận')

    def test_manual_sheet_import_keeps_payment_proof(self):
        from .views import upsert_participation_history
        upsert_participation_history(self.candidate, self.session.pk, [], 'Sheet', SHEET_ROW)
        data = CandidateParticipation.objects.get(pk=self.participation.pk).registration_data
        self.assertEqual(data['paymentProof'], 'Workspace #42')
        self.assertEqual(data['subject'], 'Toán')
        self.assertEqual(data['category'], 'Bảng A')


class SingleUpsertTests(TestCase):
    """views.py, nhập Excel trường và quét Sheet dùng chung một upsert_participation_history."""

    def setUp(self):
        self.session = ExamSession.objects.create(
            id='single', competition_id='FIMO', code='FIMO', name='FIMO 2026-2027', parent='FT',
            organizer='FT', time='2026-2027', sort_key='1',
            rounds=[{'id': 'r1', 'name': 'Vòng loại Quốc gia'}, {'id': 'r2', 'name': 'Chung kết'}],
        )
        self.candidate = Candidate.objects.create(id='single-1', code='FT-92000', name='Lê Chi', sort_key='1')

    def test_views_and_sync_are_the_same_function(self):
        from . import sync, views
        self.assertIs(views.upsert_participation_history, sync.upsert_participation_history)

    def test_attendance_from_tab_is_not_imported(self):
        from .models import RoundResult
        from .views import upsert_participation_history
        upsert_participation_history(self.candidate, self.session.pk, [
            {'round': 'VÒNG LOẠI', 'roundId': 'r1', 'attendance': 'Vắng', 'score': '15'},
        ], 'Sheet')
        result = RoundResult.objects.get(participation__candidate=self.candidate)
        self.assertEqual(result.round_name, 'Vòng loại Quốc gia')
        self.assertEqual(result.score, '15')
        self.assertEqual(result.attendance, '')

    def test_new_registration_without_rounds_enters_first_round(self):
        from .models import RoundResult
        from .views import upsert_participation_history
        upsert_participation_history(self.candidate, self.session.pk, [], 'Excel trường', {'category': 'Bảng A'}, 'fill-empty')
        result = RoundResult.objects.get(participation__candidate=self.candidate)
        self.assertEqual((result.round_id, result.round_name, result.exam_date, result.room_name), ('r1', 'Vòng loại Quốc gia', '', ''))
