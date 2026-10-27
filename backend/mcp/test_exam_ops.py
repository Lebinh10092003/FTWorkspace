"""Công cụ MCP vận hành Khảo thí."""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from authentication.models import UserProfile
from django.utils import timezone
from examination.models import (Candidate, CandidateParticipation, ExamRoom, ExaminationSheet, ExamSession, LogNote,
                                RoundResult, SessionSheetOutbox)


def _client(email, role, modules):
    user = User.objects.create_user(username=email, email=email, password="Password123!")
    UserProfile.objects.create(email=email, name=email.split("@")[0], role=role, access_modules=modules)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {Token.objects.create(user=user).key}")
    return client


class ExamOpsToolTests(TestCase):
    def setUp(self):
        self.manager = _client("kt.manager@fermat.vn", "MANAGER", ["examination"])
        self.staff = _client("kt.staff@fermat.vn", "EMPLOYEE", ["examination"])
        self.session = ExamSession.objects.create(
            id="fimo-ops", competition_id="FIMO", code="FIMO", name="FIMO 2026-2027", parent="FT", organizer="FT",
            time="2026-2027", sort_key="1",
            rounds=[{"id": "r1", "name": "Vòng loại Quốc gia"}, {"id": "r2", "name": "Chung kết Quốc gia"}],
        )
        self.room = ExamRoom.objects.create(session=self.session, round_id="r1", round_name="Vòng loại Quốc gia",
                                            common_name="Phòng", room_number="1", label="Phòng 1", mode="online")
        self.results = {}
        for i, code in enumerate(["FT-80001", "FT-80002"], 1):
            cand = Candidate.objects.create(id=code, code=code, name=f"Thí sinh {i}", sort_key=str(i))
            part = CandidateParticipation.objects.create(candidate=cand, session=self.session)
            self.results[code] = RoundResult.objects.create(
                participation=part, round_id="r1", round_name="Vòng loại Quốc gia",
                exam_room=self.room if i == 1 else None, room_name="Phòng 1" if i == 1 else "",
                attendance="Có mặt", score="12" if i == 1 else "",
            )

    def call(self, client, tool, args):
        return client.post(f"/api/mcp/action/{tool}", args, format="json")

    def test_list_round_results_and_filters(self):
        data = self.call(self.staff, "exam_list_round_results", {"session_id": "fimo-ops", "round_name": "vòng loại"}).json()["data"]
        self.assertEqual((data["total"], data["with_score"]), (2, 1))
        missing = self.call(self.staff, "exam_list_round_results",
                            {"session_id": "fimo-ops", "round_id": "r1", "missing_score": True}).json()["data"]
        self.assertEqual([r["candidate_code"] for r in missing["results"]], ["FT-80002"])
        bad = self.call(self.staff, "exam_list_round_results", {"session_id": "fimo-ops"}).json()["data"]
        self.assertFalse(bad["success"])
        self.assertIn("round_id r1", bad["error"])

    def test_update_requires_manager(self):
        res = self.call(self.staff, "exam_update_round_results",
                        {"session_id": "fimo-ops", "round_id": "r1", "updates": [{"candidate_code": "FT-80001", "score": "20"}]})
        self.assertEqual(res.status_code, 403)

    def test_update_writes_existing_result_and_skips_bad_rows(self):
        now = timezone.now()
        ExaminationSheet.objects.create(id="sheet-ops", name="FT - FIMO", url="https://docs.google.com/spreadsheets/d/x",
                                        session_id="fimo-ops", sheet_tab="FT - FIMO", stage="session-output",
                                        created_at=now, updated_at=now)
        SessionSheetOutbox.objects.all().delete()
        data = self.call(self.manager, "exam_update_round_results", {
            "session_id": "fimo-ops", "round_id": "r1",
            "updates": [
                {"candidate_code": "FT-80002", "score": "18", "score_rate": "90.5%", "eligibility": "đủ điều kiện"},
                {"candidate_code": "FT-80001", "score": "", "rank": "1"},
                {"candidate_code": "FT-99999", "score": "5"},
            ],
        }).json()["data"]
        self.assertEqual(data["updated_count"], 2)
        self.assertEqual(data["skipped"][0]["candidate_code"], "FT-99999")
        second = RoundResult.objects.get(pk=self.results["FT-80002"].pk)
        self.assertEqual((second.score, second.score_rate, second.eligibility), ("18", "90,5%", "Đủ điều kiện"))
        first = RoundResult.objects.get(pk=self.results["FT-80001"].pk)
        self.assertEqual((first.score, first.rank, first.attendance), ("12", "1", "Có mặt"))  # ô trống giữ nguyên
        self.assertEqual(RoundResult.objects.count(), 2)  # không tạo bản kết quả mới
        self.assertTrue(SessionSheetOutbox.objects.exists())  # đi qua hàng đợi ghi Sheet như web
        self.assertTrue(LogNote.objects.filter(entity_key="candidate-FT-80002", content__contains="Trợ lý AI").exists())

    def test_update_does_not_create_result_for_round_candidate_has_not_reached(self):
        data = self.call(self.manager, "exam_update_round_results", {
            "session_id": "fimo-ops", "round_id": "r2", "updates": [{"candidate_code": "FT-80001", "score": "30"}],
        }).json()["data"]
        self.assertEqual(data["updated_count"], 0)
        self.assertFalse(RoundResult.objects.filter(round_id="r2").exists())

    def test_list_rooms(self):
        data = self.call(self.staff, "exam_list_rooms", {"session_id": "fimo-ops", "round_id": "r1"}).json()["data"]
        self.assertEqual(data["room_count"], 1)
        self.assertEqual(data["rooms"][0]["assigned"], 1)
        self.assertEqual(data["candidates_without_room"], 1)

    def test_billing_overview_needs_finance_module(self):
        self.assertEqual(self.call(self.staff, "exam_billing_overview", {}).status_code, 403)
        finance = _client("ketoan@fermat.vn", "EMPLOYEE", ["finance-report"])
        data = self.call(finance, "exam_billing_overview", {"scope": "all"}).json()["data"]
        self.assertIn("awaiting_transfer", data["stats"])
