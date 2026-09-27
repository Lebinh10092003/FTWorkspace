import io
import json
import os
import tempfile
import time
from datetime import timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework.authtoken.models import Token
from authentication.models import UserProfile, WorkspaceNotification
from .models import TrainingPartner, TrainingAssessment, TrainingAssessmentAttempt, TrainingAssessmentUpload
from .assessment_storage import PREFIX, safe_answer_path
from .assessment_service import clear_attempt_from_google_sheet


class AssessmentAttemptDeletionTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(
            username="admin-delete@example.test", email="admin-delete@example.test", password="ValidPassword123!",
        )
        UserProfile.objects.create(email=user.email, name="Admin", role="ADMIN")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {Token.objects.create(user=user).key}")
        self.assessment = TrainingAssessment.objects.create(
            title="Bài có giới hạn một lượt", partner=TrainingPartner.objects.create(name="Trường kiểm thử"),
            status="published", attempt_limit=1,
            questions=[{"id": "q1", "variant": "Đề 1", "order": 1, "type": "short_answer", "text": "Câu hỏi", "points": 1}],
        )

    def create_attempt(self, *, state="submitted", sync="pending"):
        return TrainingAssessmentAttempt.objects.create(
            assessment=self.assessment, respondent_name="Người học A", email="learner@example.test",
            phone="0901234567", organization="Trường kiểm thử", position="Giáo viên",
            variant="Đề 1", expires_at=timezone.now() + timedelta(hours=1), status=state, sync_status=sync,
        )

    def delete_attempt(self, attempt, password="ValidPassword123!"):
        return self.client.delete(
            f"/api/digital-training/assessments/{self.assessment.pk}/results/{attempt.pk}/storage",
            {"confirmation_password": password}, format="json",
        )

    def reopen_attempt(self, attempt, password="ValidPassword123!", extra_minutes=30):
        return self.client.post(
            f"/api/digital-training/assessments/{self.assessment.pk}/results/{attempt.pk}/reopen",
            {"confirmation_password": password, "extra_minutes": extra_minutes}, format="json",
        )

    def learner_start(self, **overrides):
        identity = {
            "respondent_name": "Người học A", "email": "learner@example.test", "phone": "0901234567",
            "organization": "Trường kiểm thử", "position": "Giáo viên",
        }
        identity.update(overrides)
        return APIClient().post(f"/api/training-assessments/{self.assessment.public_slug}/start", identity, format="json")

    def test_admin_can_delete_unsynced_submission_and_learner_can_start_again(self):
        attempt = self.create_attempt()
        blocked = self.learner_start()
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("đủ 1 lượt", blocked.data["error"])
        response = self.delete_attempt(attempt)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(TrainingAssessmentAttempt.objects.filter(pk=attempt.pk).exists())
        self.assertTrue(WorkspaceNotification.objects.filter(event_key=f"assessment-attempt:{attempt.pk}:deleted").exists())
        restarted = self.learner_start()
        self.assertEqual(restarted.status_code, 201, restarted.data)

    def test_admin_reopen_preserves_work_and_offers_continue_on_another_browser(self):
        attempt = self.create_attempt(sync="synced")
        attempt.answers = {"q1": "Old answer"}
        attempt.progress = {"current_question_id": "q1"}
        attempt.score = 1
        attempt.save(update_fields=["answers", "progress", "score", "updated_at"])
        TrainingAssessmentUpload.objects.create(attempt=attempt, question_id="q1", original_name="old.png")
        response = self.reopen_attempt(attempt)
        self.assertEqual(response.status_code, 200, response.data)
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, "in_progress")
        self.assertEqual(attempt.answers, {"q1": "Old answer"})
        self.assertEqual(attempt.progress, {"current_question_id": "q1"})
        self.assertIsNone(attempt.score)
        self.assertEqual(attempt.sync_status, "pending")
        self.assertTrue(attempt.uploads.exists())
        self.assertAlmostEqual((attempt.expires_at - timezone.now()).total_seconds(), 1800, delta=15)
        resumed = self.learner_start()
        self.assertEqual(resumed.status_code, 409, resumed.data)
        self.assertEqual(resumed.data["code"], "unfinished_attempt")
        self.assertEqual(resumed.data["attempt"]["access_token"], str(attempt.access_token))
        self.assertEqual(resumed.data["attempt"]["answers"], {"q1": "Old answer"})

    def test_unfinished_attempt_can_be_replaced_with_new_attempt(self):
        attempt = self.create_attempt(state="in_progress")
        attempt.answers = {"q1": "Draft"}
        attempt.save(update_fields=["answers", "updated_at"])
        choice = self.learner_start()
        self.assertEqual(choice.status_code, 409, choice.data)
        self.assertEqual(choice.data["code"], "unfinished_attempt")
        rejected = self.learner_start(start_new=True, previous_attempt_token="wrong")
        self.assertEqual(rejected.status_code, 400)
        fresh = self.learner_start(start_new=True, previous_attempt_token=str(attempt.access_token))
        self.assertEqual(fresh.status_code, 201, fresh.data)
        self.assertNotEqual(fresh.data["access_token"], str(attempt.access_token))
        self.assertFalse(TrainingAssessmentAttempt.objects.filter(pk=attempt.pk).exists())

    def test_reopen_requires_open_assessment_and_correct_password(self):
        attempt = self.create_attempt()
        self.assertEqual(self.reopen_attempt(attempt, "wrong").status_code, 403)
        self.assertEqual(self.reopen_attempt(attempt, extra_minutes=0).status_code, 400)
        self.assessment.status = "closed"
        self.assessment.save(update_fields=["status", "updated_at"])
        blocked = self.reopen_attempt(attempt)
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("mở lại bài", blocked.data["error"])
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, "submitted")

    @patch("digital_training.assessment_views.clear_attempt_from_google_sheet", side_effect=RuntimeError("Sheets unavailable"))
    def test_admin_reopen_keeps_completed_attempt_if_old_score_cannot_be_cleared(self, clear_sheet):
        attempt = self.create_attempt(sync="synced")
        self.assessment.output_sheet_url = "https://docs.google.com/spreadsheets/d/test/edit"
        self.assessment.save(update_fields=["output_sheet_url", "updated_at"])
        response = self.reopen_attempt(attempt)
        self.assertEqual(response.status_code, 503, response.data)
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, "submitted")

    def test_clear_google_sheet_removes_answer_and_submission_list_rows(self):
        attempt = self.create_attempt(sync="synced")
        service = MagicMock()
        service.spreadsheets.return_value.get.return_value.execute.return_value = {
            "sheets": [{"properties": {"title": "BÀI LÀM ĐỀ 1"}}, {"properties": {"title": "DANH SÁCH BÀI LÀM"}}]
        }
        def sheet_values(**kwargs):
            result = MagicMock()
            if kwargs["range"].endswith("!G:G") or kwargs["range"].endswith("!L:L"):
                result.execute.return_value = {"values": [["header"], [str(attempt.access_token)]]}
            return result
        service.spreadsheets.return_value.values.return_value.get.side_effect = sheet_values
        layout = {"answer_sheets": {"Đề 1": "BÀI LÀM ĐỀ 1"}, "distribution": "DANH SÁCH BÀI LÀM"}
        with patch("digital_training.assessment_service.assessment_google_sheet_resources", return_value=(service, "test", layout)):
            self.assertTrue(clear_attempt_from_google_sheet(attempt))
        ranges = [call.kwargs["range"] for call in service.spreadsheets.return_value.values.return_value.clear.call_args_list]
        self.assertEqual(ranges, ["'BÀI LÀM ĐỀ 1'!A2:ZZ2", "'DANH SÁCH BÀI LÀM'!A2:ZZ2"])

    def test_duplicate_contact_prompts_support_then_admin_deletes_wrong_attempt(self):
        attempt = self.create_attempt()
        blocked = self.learner_start(respondent_name="Tên khác")
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("FermatTech", blocked.data["error"])
        self.assertEqual(self.delete_attempt(attempt).status_code, 200)
        restarted = self.learner_start(respondent_name="Tên khác")
        self.assertEqual(restarted.status_code, 201, restarted.data)

    def test_public_score_exposes_only_automatic_maximum(self):
        self.assessment.questions = [
            {"id": "theory", "variant": "Đề 1", "order": 1, "type": "single_choice", "text": "Lý thuyết", "points": 2, "correct_answers": ["A"], "options": [{"key": "A", "text": "Đúng"}]},
            {"id": "practice", "variant": "Đề 1", "order": 2, "type": "practical_submission", "text": "Thực hành", "points": 3},
        ]
        self.assessment.save(update_fields=["questions", "updated_at"])
        attempt = self.create_attempt()
        attempt.answers = {"theory": "A"}
        attempt.auto_graded_points = 2
        attempt.score = 2
        attempt.max_score = 5
        attempt.save(update_fields=["answers", "auto_graded_points", "score", "max_score", "updated_at"])
        response = APIClient().get(f"/api/training-assessment-attempts/{attempt.access_token}")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(float(response.data["auto_max_score"]), 2)
        self.assertEqual(float(response.data["max_score"]), 5)

    def test_same_browser_retake_requires_score_warning_and_confirmation(self):
        attempt = self.create_attempt()
        attempt.answers = {"q1": "Old answer"}
        attempt.score = 1
        attempt.save(update_fields=["answers", "score", "updated_at"])
        no_token = self.learner_start()
        self.assertEqual(no_token.status_code, 400)
        self.assertIn("FermatTech", no_token.data["error"])
        warning = self.learner_start(previous_attempt_token=str(attempt.access_token))
        self.assertEqual(warning.status_code, 409, warning.data)
        self.assertEqual(warning.data["code"], "retake_confirmation_required")
        self.assertEqual(float(warning.data["previous_score"]), 1)
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, "submitted")
        restarted = self.learner_start(previous_attempt_token=str(attempt.access_token), replace_previous=True)
        self.assertEqual(restarted.status_code, 201, restarted.data)
        self.assertTrue(restarted.data["retake_performed"])
        self.assertNotEqual(restarted.data["access_token"], str(attempt.access_token))
        self.assertFalse(TrainingAssessmentAttempt.objects.filter(pk=attempt.pk).exists())
        fresh = TrainingAssessmentAttempt.objects.get(access_token=restarted.data["access_token"])
        self.assertNotEqual(fresh.pk, attempt.pk)
        self.assertEqual(fresh.status, "in_progress")
        self.assertEqual(fresh.answers, {})
        self.assertIsNone(fresh.score)

    @patch("digital_training.assessment_views.clear_attempt_from_google_sheet")
    def test_retake_clears_previous_google_sheet_score(self, clear_sheet):
        attempt = self.create_attempt(sync="synced")
        self.assessment.output_sheet_url = "https://docs.google.com/spreadsheets/d/test/edit"
        self.assessment.save(update_fields=["output_sheet_url", "updated_at"])
        response = self.learner_start(previous_attempt_token=str(attempt.access_token), replace_previous=True)
        self.assertEqual(response.status_code, 201, response.data)
        clear_sheet.assert_called_once()
        self.assertEqual(str(clear_sheet.call_args.args[0].access_token), str(attempt.access_token))
        self.assertFalse(TrainingAssessmentAttempt.objects.filter(pk=attempt.pk).exists())

    @patch("digital_training.assessment_views.clear_attempt_from_google_sheet", side_effect=RuntimeError("Sheets unavailable"))
    def test_retake_preserves_previous_attempt_if_sheet_cannot_be_cleared(self, clear_sheet):
        attempt = self.create_attempt(sync="synced")
        self.assessment.output_sheet_url = "https://docs.google.com/spreadsheets/d/test/edit"
        self.assessment.save(update_fields=["output_sheet_url", "updated_at"])
        response = self.learner_start(previous_attempt_token=str(attempt.access_token), replace_previous=True)
        self.assertEqual(response.status_code, 503, response.data)
        self.assertEqual(TrainingAssessmentAttempt.objects.filter(assessment=self.assessment).count(), 1)
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, "submitted")

    def test_shared_computer_allows_another_person_with_different_contact(self):
        self.create_attempt()
        another = self.learner_start(
            respondent_name="Người học B", email="another@example.test", phone="0912345678",
        )
        self.assertEqual(another.status_code, 201, another.data)

    def test_participant_code_selects_correct_person_when_email_is_shared(self):
        self.assessment.participants = [
            {"code": "GV-1", "name": "Người thứ nhất", "email": "shared@example.test", "phone": "0901111111", "organization": "Trường", "position": "Giáo viên", "variant": "Đề 1"},
            {"code": "GV-2", "name": "Người thứ hai", "email": "shared@example.test", "phone": "0902222222", "organization": "Trường", "position": "Giáo viên", "variant": "Đề 1"},
        ]
        self.assessment.save(update_fields=["participants", "updated_at"])
        second = self.learner_start(participant_code="GV-2", email="shared@example.test")
        self.assertEqual(second.status_code, 201, second.data)
        self.assertEqual(second.data["respondent_name"], "Người thứ hai")

    def test_invalid_retake_token_cannot_erase_previous_score(self):
        attempt = self.create_attempt()
        response = self.learner_start(previous_attempt_token="invalid", replace_previous=True)
        self.assertEqual(response.status_code, 400)
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, "submitted")

    def test_admin_can_paste_practical_link_and_regrade_only_changed_question(self):
        self.assessment.questions = [
            {"id": "theory", "variant": "Đề 1", "order": 1, "type": "single_choice", "text": "Lý thuyết", "points": 2, "correct_answers": ["A"], "options": [{"key": "A", "text": "Đúng"}, {"key": "B", "text": "Sai"}]},
            {"id": "practice", "variant": "Đề 1", "order": 2, "type": "practical_submission", "text": "Dán link", "points": 3},
        ]
        self.assessment.save(update_fields=["questions", "updated_at"])
        attempt = self.create_attempt()
        attempt.answers = {"theory": "A", "practice": {"link": "https://example.test/old"}}
        attempt.grading = {"practice": 3}
        attempt.auto_graded_points = 2
        attempt.practical_score = 3
        attempt.score = 5
        attempt.max_score = 5
        attempt.save(update_fields=["answers", "grading", "auto_graded_points", "practical_score", "score", "max_score", "updated_at"])
        response = self.client.patch(
            f"/api/digital-training/assessments/{self.assessment.pk}/results/{attempt.pk}/answers",
            {"answers": {"practice": {"link": "https://drive.google.com/new"}}}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        attempt.refresh_from_db()
        self.assertEqual(attempt.answers["practice"]["link"], "https://drive.google.com/new")
        self.assertNotIn("practice", attempt.grading)
        self.assertEqual(float(attempt.score), 2)
        self.assertTrue(attempt.manual_grading_required)
        self.assertIn("đã sửa câu trả lời", attempt.grading_notes[-1]["content"])

    def test_answer_edit_rejects_invalid_link_and_wrong_variant(self):
        attempt = self.create_attempt()
        self.assessment.questions = [
            {"id": "practice", "variant": "Đề 1", "order": 1, "type": "practical_submission", "text": "Dán link", "points": 3},
            {"id": "other", "variant": "Đề 2", "order": 1, "type": "short_answer", "text": "Khác", "points": 1},
        ]
        self.assessment.save(update_fields=["questions", "updated_at"])
        url = f"/api/digital-training/assessments/{self.assessment.pk}/results/{attempt.pk}/answers"
        bad_link = self.client.patch(url, {"answers": {"practice": {"link": "javascript:bad"}}}, format="json")
        self.assertEqual(bad_link.status_code, 400)
        other_variant = self.client.patch(url, {"answers": {"other": "wrong"}}, format="json")
        self.assertEqual(other_variant.status_code, 400)
        attempt.refresh_from_db()
        self.assertEqual(attempt.answers, {})

    def test_admin_can_delete_active_attempt_and_wrong_password_is_rejected(self):
        attempt = self.create_attempt(state="in_progress")
        denied = self.delete_attempt(attempt, "wrong")
        self.assertEqual(denied.status_code, 403)
        self.assertTrue(TrainingAssessmentAttempt.objects.filter(pk=attempt.pk).exists())
        response = self.delete_attempt(attempt)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(TrainingAssessmentAttempt.objects.filter(pk=attempt.pk).exists())

    def test_google_log_failure_does_not_block_deletion(self):
        self.assessment.output_sheet_url = "https://docs.google.com/spreadsheets/d/test-sheet-id/edit"
        self.assessment.save(update_fields=["output_sheet_url", "updated_at"])
        attempt = self.create_attempt(sync="synced")
        with patch("digital_training.assessment_views.clear_attempt_from_google_sheet") as clear_sheet, patch(
            "digital_training.assessment_views.append_assessment_deletion_log", side_effect=RuntimeError("Sheets offline")
        ):
            response = self.delete_attempt(attempt)
        self.assertEqual(response.status_code, 200, response.data)
        clear_sheet.assert_called_once()
        self.assertIn("chưa ghi được", response.data["sheet_log_warning"].lower())
        self.assertFalse(TrainingAssessmentAttempt.objects.filter(pk=attempt.pk).exists())

class AssessmentMaintenanceTests(TestCase):
    def setUp(self):
        self.manager = UserProfile.objects.create(email="editor@example.test", name="Editor", role="MANAGER", access_modules=["digital-training"])
        self.client = APIClient()
        self.client.force_authenticate(self.manager)
        self.assessment = TrainingAssessment.objects.create(title="Test", partner=TrainingPartner.objects.create(name="Test"), questions=[
            {"id": "q1", "variant": "Đề 1", "order": 1, "type": "short_answer", "text": "First", "correct_answers": ["1"], "points": 1},
            {"id": "q2", "variant": "Đề 2", "order": 1, "type": "short_answer", "text": "Other", "correct_answers": ["2"], "points": 1},
        ])
        self.url = f"/api/digital-training/assessment-previews/{self.assessment.public_slug}"

    def test_creator_edits_one_question_and_preserves_other_variant(self):
        preview = self.client.get(self.url + "?role=creator&variant=Đề 1")
        self.assertEqual(preview.status_code, 200)
        original = preview.data["questions"][0]
        other = self.assessment.questions[1]
        response = self.client.patch(self.url, {"original": original, "question": {**original, "text": "Edited", "variant": "HACK"}}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assessment.refresh_from_db()
        self.assertEqual(self.assessment.questions[0]["text"], "Edited")
        self.assertEqual(self.assessment.questions[0]["variant"], "Đề 1")
        self.assertEqual(self.assessment.questions[1], other)

    def test_stale_question_rejected(self):
        original = self.assessment.questions[0].copy()
        self.assessment.questions[0]["text"] = "Changed elsewhere"
        self.assessment.save()
        response = self.client.patch(self.url, {"original": original, "question": original}, format="json")
        self.assertEqual(response.status_code, 409)

    def test_anonymous_cannot_edit_or_read_preview(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.patch(self.url, {}, format="json").status_code, [401, 403])
        self.assertIn(self.client.get(self.url + "?role=creator").status_code, [401, 403])

    def test_cleanup_preserves_live_recent_and_direct_links(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder, override_settings(MEDIA_ROOT=folder):
            root = Path(folder) / PREFIX
            root.mkdir(parents=True)
            for name in ["orphan.png", "live.png", "linked.png", "recent.png"]:
                (root / name).write_bytes(b"test")
                if name != "recent.png":
                    os.utime(root / name, (time.time() - 90000, time.time() - 90000))
            attempt = TrainingAssessmentAttempt.objects.create(assessment=self.assessment, respondent_name="Test", expires_at=timezone.now(), variant="Đề 1", answers={"q1": {"upload_url": "/uploads/" + PREFIX + "linked.png"}})
            TrainingAssessmentUpload.objects.create(attempt=attempt, question_id="q1", file=PREFIX + "live.png", original_name="live.png")
            output = io.StringIO()
            call_command("cleanup_assessment_uploads", stdout=output)
            self.assertEqual(json.loads(output.getvalue())["orphan_files_older_than_24h"], 1)
            self.assertTrue((root / "orphan.png").exists())
            call_command("cleanup_assessment_uploads", delete=True, stdout=io.StringIO())
            self.assertFalse((root / "orphan.png").exists())
            for name in ["live.png", "linked.png", "recent.png"]:
                self.assertTrue((root / name).exists())
            self.assertIsNone(safe_answer_path(PREFIX + "../../outside.png"))

    def test_cascade_removes_file_after_commit(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder, override_settings(MEDIA_ROOT=folder):
            root = Path(folder) / PREFIX
            root.mkdir(parents=True)
            path = root / "deleted.png"
            path.write_bytes(b"test")
            attempt = TrainingAssessmentAttempt.objects.create(assessment=self.assessment, respondent_name="Test", expires_at=timezone.now(), variant="Đề 1")
            TrainingAssessmentUpload.objects.create(attempt=attempt, question_id="q1", file=PREFIX + "deleted.png", original_name="deleted.png")
            with self.captureOnCommitCallbacks(execute=True):
                self.assessment.delete()
                self.assertTrue(path.exists())
            self.assertFalse(path.exists())
            self.assertFalse(TrainingAssessmentAttempt.objects.exists())
            self.assertFalse(TrainingAssessmentUpload.objects.exists())


    def test_rollback_keeps_upload_file(self):
        from django.db import transaction
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as folder, override_settings(MEDIA_ROOT=folder):
            path = Path(folder) / PREFIX / "rollback.png"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"test")
            attempt = TrainingAssessmentAttempt.objects.create(assessment=self.assessment, respondent_name="Test", expires_at=timezone.now(), variant="V1")
            upload = TrainingAssessmentUpload.objects.create(attempt=attempt, question_id="q1", file=PREFIX + "rollback.png", original_name="rollback.png")
            with self.captureOnCommitCallbacks(execute=True):
                try:
                    with transaction.atomic():
                        upload.delete()
                        raise ValueError("rollback")
                except ValueError:
                    pass
            self.assertTrue(path.exists())
            self.assertEqual(TrainingAssessmentUpload.objects.count(), 1)
