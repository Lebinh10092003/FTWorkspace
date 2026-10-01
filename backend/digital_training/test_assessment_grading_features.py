from datetime import timedelta
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from authentication.models import UserProfile

from .assessment_service import _assessment_output_layout, _sheet_answer_value, sync_assessment_grades_from_google_sheet
from .assessment_views import _admin_attempt_payloads
from .models import TrainingAssessment, TrainingAssessmentAttempt, TrainingPartner


class AssessmentGradingFeatureTests(TestCase):
    def setUp(self):
        self.partner = TrainingPartner.objects.create(name="Đơn vị kiểm thử")
        self.assessment = TrainingAssessment.objects.create(
            title="Bài kiểm thử chấm",
            partner=self.partner,
            status="published",
            questions=[
                {
                    "id": "auto-1", "variant": "Đề 1", "order": 1,
                    "type": "single_choice", "text": "Chọn B",
                    "options": [{"key": "A", "text": "Sai"}, {"key": "B", "text": "Đúng"}],
                    "correct_answers": ["B"], "points": 1,
                },
                {
                    "id": "practice-1", "variant": "Đề 1", "order": 2,
                    "type": "practical_submission", "category": "NotebookLM",
                    "text": "Nộp minh chứng", "points": 2,
                },
            ],
        )

    def attempt(self, name, answers=None):
        return TrainingAssessmentAttempt.objects.create(
            assessment=self.assessment,
            respondent_name=name,
            email=f"{name.lower()}@example.test",
            variant="Đề 1",
            answers=answers or {},
            expires_at=timezone.now() + timedelta(hours=1),
            max_score=3,
            status="submitted",
        )

    def test_admin_payload_exposes_automatic_score_and_duplicate_practical_links(self):
        first = self.attempt("An", {"auto-1": "B", "practice-1": {"link": "https://example.test/shared"}})
        second = self.attempt("Binh", {"auto-1": "A", "practice-1": {"link": "https://example.test/shared/"}})

        payloads = _admin_attempt_payloads(
            self.assessment.attempts.order_by("id"), RequestFactory().get("/api/results"),
        )

        self.assertEqual(payloads[0]["automatic_grading"]["auto-1"], 1.0)
        self.assertEqual(payloads[1]["automatic_grading"]["auto-1"], 0.0)
        self.assertEqual(payloads[0]["duplicate_link_warnings"][0]["matches"][0]["attempt_id"], second.id)
        self.assertEqual(payloads[0]["duplicate_link_warnings"][0]["scope"], "other_attempt")
        self.assertEqual(payloads[1]["duplicate_link_warnings"][0]["matches"][0]["attempt_id"], first.id)

    def test_admin_payload_flags_duplicate_practical_link_within_the_same_attempt(self):
        assessment = TrainingAssessment.objects.create(
            title="Bài có 2 câu thực hành",
            partner=self.partner,
            status="published",
            questions=[
                {
                    "id": "practice-1", "variant": "Đề 1", "order": 1,
                    "type": "practical_submission", "category": "NotebookLM",
                    "text": "Nộp minh chứng 1", "points": 2,
                },
                {
                    "id": "practice-2", "variant": "Đề 1", "order": 2,
                    "type": "practical_submission", "category": "NotebookLM",
                    "text": "Nộp minh chứng 2", "points": 2,
                },
            ],
        )
        attempt = TrainingAssessmentAttempt.objects.create(
            assessment=assessment, respondent_name="Em", email="em@example.test", variant="Đề 1",
            answers={
                "practice-1": {"link": "https://example.test/self-copy"},
                "practice-2": {"link": "https://example.test/self-copy/"},
            },
            expires_at=timezone.now() + timedelta(hours=1), max_score=4, status="submitted",
        )

        payloads = _admin_attempt_payloads(
            assessment.attempts.order_by("id"), RequestFactory().get("/api/results"),
        )

        warnings = payloads[0]["duplicate_link_warnings"]
        same_attempt_warnings = [item for item in warnings if item["scope"] == "same_attempt"]
        self.assertEqual(len(same_attempt_warnings), 2)
        flagged_question_ids = {item["question_id"] for item in same_attempt_warnings}
        self.assertEqual(flagged_question_ids, {"practice-1", "practice-2"})
        practice_1_warning = next(item for item in same_attempt_warnings if item["question_id"] == "practice-1")
        self.assertEqual(practice_1_warning["matches"][0]["question_id"], "practice-2")
        self.assertEqual(practice_1_warning["matches"][0]["attempt_id"], attempt.id)
        self.assertFalse([item for item in warnings if item["scope"] == "other_attempt"])

    def test_grading_note_is_saved_per_question_and_old_general_notes_are_preserved(self):
        manager = UserProfile.objects.create(email="grader@example.test", name="Grader", role="MANAGER", access_modules=["digital-training"])
        client = APIClient()
        client.force_authenticate(manager)
        self.assessment.status = "closed"
        self.assessment.save(update_fields=["status"])
        attempt = self.attempt("Giang", {"auto-1": "B", "practice-1": {"link": "https://example.test/work"}})
        attempt.grading_notes = [{
            "id": "legacy1", "content": "Ghi chú cũ trước khi có question_id",
            "grader": "Cũ", "created_at": timezone.now().isoformat(),
        }]
        attempt.save(update_fields=["grading_notes"])
        url = f"/api/digital-training/assessments/{self.assessment.pk}/results/{attempt.pk}"

        response = client.patch(url, {"grading_note": "Cần bổ sung minh chứng", "question_id": "practice-1"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)

        attempt.refresh_from_db()
        self.assertEqual(len(attempt.grading_notes), 2)
        legacy_note, new_note = attempt.grading_notes
        self.assertEqual(legacy_note["id"], "legacy1")
        self.assertNotIn("question_id", legacy_note)
        self.assertEqual(new_note["question_id"], "practice-1")
        self.assertEqual(new_note["content"], "Cần bổ sung minh chứng")
        self.assertEqual(new_note["grader"], "Grader")

    def test_multiple_images_can_be_uploaded_and_deleted_individually(self):
        self.assessment.questions[1].update(type="file_upload", category="Học liệu số với Gemini")
        self.assessment.save(update_fields=["questions"])
        attempt = self.attempt("Chi")
        attempt.status = "in_progress"
        attempt.save(update_fields=["status"])
        client = APIClient()
        endpoint = f"/api/training-assessment-attempts/{attempt.access_token}/upload"
        first = client.post(endpoint, {
            "question_id": "practice-1",
            "file": SimpleUploadedFile("one.png", b"\x89PNG\r\n\x1a\nfirst", content_type="image/png"),
        }, format="multipart")
        second = client.post(endpoint, {
            "question_id": "practice-1",
            "file": SimpleUploadedFile("two.png", b"\x89PNG\r\n\x1a\nsecond", content_type="image/png"),
        }, format="multipart")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 201, second.data)
        self.assertEqual(attempt.uploads.count(), 2)

        removed = client.delete(
            f"/api/training-assessment-attempts/{attempt.access_token}/uploads/{first.data['id']}"
        )
        self.assertEqual(removed.status_code, 200, removed.data)
        self.assertEqual(attempt.uploads.count(), 1)
        attempt.refresh_from_db()
        self.assertEqual(attempt.answers["practice-1"]["upload_id"], str(second.data["id"]))

    def test_link_question_in_notebooklm_cannot_upload_images(self):
        attempt = self.attempt("Link")
        attempt.status = "in_progress"
        attempt.save(update_fields=["status"])
        response = APIClient().post(f"/api/training-assessment-attempts/{attempt.access_token}/upload", {
            "question_id": "practice-1", "file": SimpleUploadedFile("one.png", b"image", content_type="image/png"),
        }, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(attempt.uploads.count(), 0)

    def test_image_question_rejects_documents_and_oversized_images(self):
        self.assessment.questions[1].update(type="file_upload", category="Gemini")
        self.assessment.save(update_fields=["questions"])
        attempt = self.attempt("Image")
        attempt.status = "in_progress"
        attempt.save(update_fields=["status"])
        for name, content, mime in [("one.pdf", b"document", "application/pdf"), ("large.png", b"x" * (5 * 1024 * 1024 + 1), "image/png")]:
            response = APIClient().post(f"/api/training-assessment-attempts/{attempt.access_token}/upload", {
                "question_id": "practice-1", "file": SimpleUploadedFile(name, content, content_type=mime),
            }, format="multipart")
            self.assertEqual(response.status_code, 400)
        self.assertEqual(attempt.uploads.count(), 0)

    def test_sheet_layout_and_practical_cells_use_clear_clickable_urls(self):
        layout = _assessment_output_layout(self.assessment)
        self.assertEqual(layout["distribution"], "DANH SÁCH BÀI LÀM")
        self.assertEqual(layout["answer_sheets"]["Đề 1"], "BÀI LÀM ĐỀ 1")
        value = _sheet_answer_value(
            self.assessment.questions[1],
            {"link": "https://example.test/work", "upload_urls": "https://example.test/one.png\nhttps://example.test/two.png"},
        )
        self.assertEqual(
            value,
            "https://example.test/work\nhttps://example.test/one.png\nhttps://example.test/two.png",
        )
        self.assertNotIn("Link sản phẩm", value)

    @patch("digital_training.assessment_service.assessment_google_sheet_resources")
    def test_sheet_to_system_sync_updates_scores_without_touching_answers(self, resources):
        attempt = self.attempt("Dung", {"auto-1": "B", "practice-1": {"link": "https://example.test/original"}})
        attempt.auto_graded_points = 1
        attempt.score = 1
        attempt.practical_score = None
        attempt.manual_grading_required = True
        attempt.save()

        class Request:
            def __init__(self, payload): self.payload = payload
            def execute(self): return self.payload

        class Values:
            def get(self, **kwargs):
                return Request({"values": [["Mã lượt làm", "Điểm thực hành", "Tổng điểm", "Trạng thái chấm"], [str(attempt.access_token), "1,5", "1", "Cần chấm"]]})

        class Spreadsheets:
            def get(self, **kwargs): return Request({"sheets": [{"properties": {"title": "BÀI LÀM ĐỀ 1"}}]})
            def values(self): return Values()

        class Service:
            def spreadsheets(self): return Spreadsheets()

        resources.return_value = Service(), "sheet-id", _assessment_output_layout(self.assessment)
        outcome = sync_assessment_grades_from_google_sheet(self.assessment)

        attempt.refresh_from_db()
        self.assertEqual(outcome, {"updated": 1, "errors": []})
        self.assertEqual(float(attempt.score), 2.5)
        self.assertEqual(float(attempt.practical_score), 1.5)
        self.assertFalse(attempt.manual_grading_required)
        self.assertEqual(attempt.answers["practice-1"]["link"], "https://example.test/original")
