import json
from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from authentication.models import UserProfile, WorkspaceNotification
from .assessment_lifecycle import (
    assessment_retention_anchor,
    close_due_assessments,
    refresh_and_backup_assessment,
    lifecycle_warning,
    refresh_assessment_status,
    run_assessment_lifecycle,
)
from .assessment_service import _sheet_attempt_row
from .models import TrainingAssessment, TrainingAssessmentAttempt, TrainingPartner


class AssessmentLifecycleTests(TestCase):
    def setUp(self):
        self.admin = UserProfile.objects.create(email="admin@example.test", name="Admin", role="ADMIN", access_modules=[])
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.partner = TrainingPartner.objects.create(name="THCS Chu Văn An")
        self.assessment = TrainingAssessment.objects.create(
            title="Bài kiểm tra cuối khóa", partner=self.partner, status="closed",
            closed_at=timezone.now() - timedelta(days=14),
            questions=[{"id": "q1", "variant": "Đề 1", "order": 1, "type": "short_answer", "text": "Câu hỏi", "points": 1}],
        )
        self.attempt = TrainingAssessmentAttempt.objects.create(
            assessment=self.assessment, respondent_name="Học viên", variant="Đề 1",
            answers={"q1": "Trả lời"}, progress={"q1": True}, grading_notes=[{"content": "Ghi chú"}],
            manual_grading_required=True, status="submitted", expires_at=timezone.now(), submitted_at=timezone.now(),
        )

    def test_warning_milestones_and_countdown(self):
        warning = lifecycle_warning(self.assessment)
        self.assertEqual(warning["label"], "Hãy chấm bài")
        self.assessment.closed_at = timezone.now() - timedelta(days=21)
        self.assertEqual(lifecycle_warning(self.assessment)["remaining"], 10)
        self.assessment.closed_at = timezone.now() - timedelta(days=28)
        self.assertIn("3 ngày", lifecycle_warning(self.assessment)["label"])

    def test_status_becomes_graded_only_after_scores_are_complete(self):
        self.attempt.manual_grading_required = False
        self.attempt.save(update_fields=["manual_grading_required"])
        refresh_assessment_status(self.assessment)
        self.assessment.refresh_from_db()
        self.assertEqual(self.assessment.status, "closed")
        self.attempt.score = 1
        self.attempt.max_score = 1
        self.attempt.save(update_fields=["score", "max_score"])
        refresh_assessment_status(self.assessment)
        self.assessment.refresh_from_db()
        self.assertEqual(self.assessment.status, "graded")

    def test_scheduled_close_grades_active_attempt_at_deadline_once(self):
        deadline = timezone.now().replace(second=0, microsecond=0)
        self.assessment.status = "published"
        self.assessment.closes_at = deadline
        self.assessment.closed_at = None
        self.assessment.questions = [{
            "id": "q1", "variant": "Đề 1", "order": 1, "type": "single_choice",
            "text": "Câu hỏi", "points": 2,
            "options": [{"key": "A", "text": "Đúng"}, {"key": "B", "text": "Sai"}],
            "correct_answers": ["A"],
        }]
        self.assessment.save(update_fields=["status", "closes_at", "closed_at", "questions"])
        self.attempt.status = "in_progress"
        self.attempt.answers = {"q1": "A"}
        self.attempt.expires_at = deadline + timedelta(minutes=30)
        self.attempt.submitted_at = None
        self.attempt.save(update_fields=["status", "answers", "expires_at", "submitted_at"])

        self.assertEqual(close_due_assessments(deadline - timedelta(seconds=1)), 0)
        self.assertEqual(close_due_assessments(deadline), 1)
        self.assertEqual(close_due_assessments(deadline + timedelta(minutes=1)), 0)
        self.assessment.refresh_from_db()
        self.attempt.refresh_from_db()
        self.assertEqual(self.assessment.status, "closed")
        self.assertEqual(self.assessment.retention_started_at, deadline)
        self.assertEqual(self.attempt.status, "timed_out")
        self.assertEqual(self.attempt.submitted_at, deadline)
        self.assertEqual(self.attempt.score, 2)
        self.assertFalse(self.attempt.manual_grading_required)

    def test_admin_detail_closes_overdue_assessment_when_opened(self):
        self.assessment.status = "published"
        self.assessment.closes_at = timezone.now() - timedelta(seconds=1)
        self.assessment.closed_at = None
        self.assessment.save(update_fields=["status", "closes_at", "closed_at"])

        response = self.client.get(f"/api/digital-training/assessments/{self.assessment.pk}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "closed")
        self.assessment.refresh_from_db()
        self.assertEqual(self.assessment.status, "closed")

    @patch("digital_training.assessment_views.wake_assessment_closer")
    def test_schedule_change_wakes_deadline_worker(self, wake_worker):
        new_deadline = timezone.now() + timedelta(hours=2)

        response = self.client.patch(
            f"/api/digital-training/assessments/{self.assessment.pk}",
            {"closes_at": new_deadline.isoformat()}, format="json",
        )

        self.assertEqual(response.status_code, 200)
        wake_worker.assert_called_once_with()

    @patch("digital_training.assessment_lifecycle.verify_assessment_backup")
    def test_finishing_the_last_grade_immediately_starts_and_completes_backup(self, verify):
        def complete_backup(assessment, rebuild=True):
            assessment.status = "backup_complete"
            assessment.backup_completed_at = timezone.now()
            assessment.backup_retry_at = None
            assessment.save(update_fields=["status", "backup_completed_at", "backup_retry_at", "updated_at"])
            return True, {"attemptCount": 1}

        verify.side_effect = complete_backup
        self.attempt.manual_grading_required = False
        self.attempt.score = 1
        self.attempt.max_score = 1
        self.attempt.save(update_fields=["manual_grading_required", "score", "max_score"])

        refresh_and_backup_assessment(self.assessment)

        self.assessment.refresh_from_db()
        self.assertEqual(self.assessment.status, "backup_complete")
        self.assertIsNotNone(self.assessment.backup_completed_at)
        verify.assert_called_once_with(self.assessment, rebuild=True)

    @patch("digital_training.assessment_lifecycle.verify_assessment_backup", side_effect=RuntimeError("Drive unavailable"))
    def test_failed_automatic_backup_stays_graded_and_is_scheduled_for_retry(self, _verify):
        self.assessment.status = "graded"
        self.assessment.graded_at = timezone.now()
        self.assessment.save(update_fields=["status", "graded_at"])

        refresh_and_backup_assessment(self.assessment)

        self.assessment.refresh_from_db()
        self.assertEqual(self.assessment.status, "graded")
        self.assertEqual(self.assessment.sync_status, "error")
        self.assertAlmostEqual(
            (self.assessment.backup_retry_at - timezone.now()).total_seconds(),
            86400,
            delta=5,
        )
        self.assertTrue(WorkspaceNotification.objects.filter(title="Sao lưu bài kiểm tra chưa thành công").exists())

    @patch("digital_training.assessment_lifecycle.verify_assessment_backup")
    def test_assessment_list_catches_up_an_existing_graded_row(self, verify):
        self.assessment.status = "graded"
        self.assessment.graded_at = timezone.now() - timedelta(days=1)
        self.assessment.save(update_fields=["status", "graded_at"])

        def complete_backup(assessment, rebuild=True):
            assessment.status = "backup_complete"
            assessment.backup_completed_at = timezone.now()
            assessment.save(update_fields=["status", "backup_completed_at", "updated_at"])
            return True, {"attemptCount": 1}

        verify.side_effect = complete_backup
        response = self.client.get("/api/digital-training/assessments")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]["status"], "backup_complete")
        verify.assert_called_once()

    def test_reopen_clears_counter_and_closing_again_resets_it(self):
        self.assessment.retention_started_at = timezone.now() - timedelta(days=20)
        self.assessment.next_lifecycle_at = timezone.now() - timedelta(days=6)
        self.assessment.retention_milestone = 14
        self.assessment.save(update_fields=["retention_started_at", "next_lifecycle_at", "retention_milestone"])
        response = self.client.patch(
            f"/api/digital-training/assessments/{self.assessment.pk}", {"status": "published"}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assessment.refresh_from_db()
        self.assertIsNone(self.assessment.retention_started_at)
        self.assertIsNone(self.assessment.next_lifecycle_at)
        response = self.client.patch(
            f"/api/digital-training/assessments/{self.assessment.pk}", {"status": "closed"}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assessment.refresh_from_db()
        self.assertAlmostEqual(
            (self.assessment.next_lifecycle_at - self.assessment.retention_started_at).total_seconds(),
            14 * 86400,
            delta=2,
        )

    def test_draft_delete_is_recoverable_for_three_days(self):
        draft = TrainingAssessment.objects.create(title="Nháp", partner=self.partner)
        response = self.client.delete(f"/api/digital-training/assessments/{draft.pk}", {}, format="json")
        self.assertEqual(response.status_code, 202)
        draft.refresh_from_db()
        self.assertIsNotNone(draft.trashed_at)
        self.assertAlmostEqual((draft.purge_at - draft.trashed_at).total_seconds(), 3 * 86400, delta=2)
        response = self.client.post(f"/api/digital-training/assessments-trash/{draft.pk}/restore", {}, format="json")
        self.assertEqual(response.status_code, 200)
        draft.refresh_from_db()
        self.assertIsNone(draft.trashed_at)

    def test_sheet_attempt_row_contains_complete_json(self):
        row = _sheet_attempt_row(self.attempt, self.assessment.questions)
        payload = json.loads(row[-1])
        self.assertEqual(payload["answers"], {"q1": "Trả lời"})
        self.assertEqual(payload["grading_notes"][0]["content"], "Ghi chú")

    def test_notification_targets_digital_training_users(self):
        WorkspaceNotification.objects.create(
            event_key="test-warning", title="Hãy chấm bài", message="Kiểm tra",
            target_modules=["digital-training"],
        )
        response = self.client.get("/api/notifications")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["unreadCount"], 1)

    def test_legacy_completed_assessment_uses_attempt_end_as_anchor(self):
        self.assessment.status = "backup_complete"
        self.assessment.closed_at = None
        self.assessment.closes_at = None
        self.assessment.save(update_fields=["status", "closed_at", "closes_at"])
        ended_at = timezone.now() - timedelta(days=28)
        TrainingAssessmentAttempt.objects.filter(pk=self.attempt.pk).update(
            expires_at=ended_at, submitted_at=ended_at,
        )
        self.assertEqual(assessment_retention_anchor(self.assessment).date(), ended_at.date())
        self.assertIn("3 ng\u00e0y", lifecycle_warning(self.assessment)["label"])

    @patch("digital_training.assessment_lifecycle.verify_assessment_backup", side_effect=RuntimeError("Sheet unavailable"))
    def test_day_31_moves_to_three_day_trash_when_backup_fails(self, _verify):
        assessment_id = self.assessment.pk
        self.assessment.retention_started_at = timezone.now() - timedelta(days=31)
        self.assessment.next_lifecycle_at = timezone.now()
        self.assessment.save(update_fields=["retention_started_at", "next_lifecycle_at"])
        result = run_assessment_lifecycle()
        self.assertEqual(result["failedBackup"], 1)
        self.assertEqual(result["deleted"], 0)
        self.assertEqual(result["trashed"], 1)
        self.assertTrue(TrainingAssessment.objects.filter(pk=assessment_id).exists())
        self.assessment.refresh_from_db()
        self.assertIsNotNone(self.assessment.trashed_at)
        self.assertAlmostEqual((self.assessment.purge_at - self.assessment.trashed_at).total_seconds(), 3 * 86400, delta=2)
        warning = WorkspaceNotification.objects.get(title="Khẩn cấp: sao lưu lỗi trước khi xóa")
        self.assertEqual(warning.severity, "urgent")
        self.assertEqual(warning.target_modules, ["digital-training"])

    @patch("digital_training.assessment_lifecycle.verify_assessment_backup", return_value=(True, {}))
    def test_day_31_hard_deletes_after_verified_backup(self, _verify):
        assessment_id = self.assessment.pk
        self.assessment.retention_started_at = timezone.now() - timedelta(days=31)
        self.assessment.next_lifecycle_at = timezone.now()
        self.assessment.save(update_fields=["retention_started_at", "next_lifecycle_at"])
        result = run_assessment_lifecycle()
        self.assertEqual(result["backedUp"], 1)
        self.assertEqual(result["deleted"], 1)
        self.assertFalse(TrainingAssessment.objects.filter(pk=assessment_id).exists())
