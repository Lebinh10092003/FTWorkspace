import hashlib
import json
import logging
from datetime import timedelta

from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone

from authentication.notifications import notify_workspace

from .assessment_service import grade_attempt, prepare_assessment_google_sheet, rebuild_assessment_google_sheet_rows, sync_attempt_to_google_sheet, variants_for
from .models import TrainingAssessment

logger = logging.getLogger(__name__)

RETENTION_DELETE_DAY = 31
RETENTION_MILESTONES = (14, 21, 28, RETENTION_DELETE_DAY)
DRAFT_TRASH_DAYS = 3
BACKUP_RETRY_DELAY = timedelta(days=1)


def assessment_retention_anchor(assessment):
    """Return the real end of the test, including a safe fallback for legacy rows."""
    if assessment.retention_started_at:
        return assessment.retention_started_at
    if assessment.closes_at:
        return assessment.closes_at
    if assessment.closed_at:
        return assessment.closed_at
    if assessment.status not in {"closed", "graded", "backup_complete"}:
        return None
    completed = assessment.attempts.filter(status__in=["submitted", "timed_out"]).aggregate(
        last_submitted=Max("submitted_at"), last_expiry=Max("expires_at")
    )
    candidates = [value for value in completed.values() if value]
    if candidates:
        return max(candidates)
    base = assessment.opens_at or assessment.created_at
    return base + timedelta(minutes=max(1, assessment.duration_minutes or 1)) if base else None


def refresh_assessment_status(assessment):
    """Promote a closed assessment once every submitted answer has been graded."""
    if assessment.status not in {"closed", "graded", "backup_complete"}:
        return assessment
    completed = assessment.attempts.filter(status__in=["submitted", "timed_out"])
    if (
        completed.exists()
        and not completed.filter(manual_grading_required=True).exists()
        and not completed.filter(score__isnull=True).exists()
    ):
        if assessment.status == "closed":
            assessment.status = "graded"
        assessment.graded_at = assessment.graded_at or timezone.now()
        assessment.save(update_fields=["status", "graded_at", "updated_at"])
    return assessment


def start_retention_counter(assessment, started_at=None):
    """Reset the lifecycle clock whenever a published assessment is closed."""
    started_at = started_at or timezone.now()
    assessment.closed_at = started_at
    assessment.retention_started_at = started_at
    assessment.retention_milestone = 0
    assessment.next_lifecycle_at = started_at + timedelta(days=RETENTION_MILESTONES[0])
    assessment.save(update_fields=[
        "closed_at", "retention_started_at", "retention_milestone", "next_lifecycle_at", "updated_at",
    ])
    return assessment


def _next_milestone(days):
    return next((milestone for milestone in RETENTION_MILESTONES if milestone > days), None)


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def verify_assessment_backup(assessment, *, rebuild=True):
    """Rebuild and then prove that questions, answers and durable media links exist in Sheet."""
    if not assessment.output_sheet_url:
        raise ValueError("Bài kiểm tra chưa có Google Sheet đáp án.")
    if assessment.attempts.filter(status="in_progress").exists():
        raise ValueError("Vẫn còn người đang làm bài; chưa thể chốt bản sao cuối cùng.")
    if assessment.attempts.filter(status__in=["submitted", "timed_out"], manual_grading_required=True).exists():
        raise ValueError("Vẫn còn bài chưa chấm; chưa thể xác nhận bản sao cuối cùng.")
    resources = prepare_assessment_google_sheet(assessment) if rebuild else None
    service, spreadsheet_id, layout = rebuild_assessment_google_sheet_rows(assessment, resources)
    errors = []
    expected_question_ids = set()
    for variant in variants_for(assessment):
        expected = [item for item in assessment.questions if str(item.get("variant") or "") == variant]
        rows = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f"'{layout['question_sheets'][variant]}'!A2:R"
        ).execute().get("values", [])
        by_id = {str(row[1]): row for row in rows if len(row) > 1 and str(row[1]).strip()}
        for question in expected:
            question_id = str(question.get("id") or "")
            expected_question_ids.add(question_id)
            row = by_id.get(question_id)
            if not row:
                errors.append(f"Thiếu câu hỏi {question_id} ({variant}) trong Sheet.")
                continue
            try:
                raw = json.loads(row[17])
            except (IndexError, TypeError, json.JSONDecodeError):
                errors.append(f"Câu hỏi {question_id} chưa có bản JSON đầy đủ.")
                continue
            if _canonical(raw) != _canonical(question):
                errors.append(f"Dữ liệu câu hỏi {question_id} chưa khớp bản trên web.")

    expected_attempt_tokens = set()
    for variant in variants_for(assessment):
        rows = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f"'{layout['answer_sheets'][variant]}'!A2:ZZ"
        ).execute().get("values", [])
        by_token = {str(row[6]): row for row in rows if len(row) > 6 and str(row[6]).strip()}
        for attempt in assessment.attempts.filter(variant=variant).exclude(status="in_progress"):
            token = str(attempt.access_token)
            expected_attempt_tokens.add(token)
            row = by_token.get(token)
            if not row:
                errors.append(f"Thiếu bài làm {token} trong Sheet.")
                continue
            try:
                raw = json.loads(row[-1])
            except (TypeError, json.JSONDecodeError):
                errors.append(f"Bài làm {token} chưa có bản JSON đầy đủ.")
                continue
            expected_raw = {
                "answers": attempt.answers or {}, "progress": attempt.progress or {},
                "grading": attempt.grading or {}, "grading_notes": attempt.grading_notes or [],
            }
            if _canonical(raw) != _canonical(expected_raw):
                errors.append(f"Dữ liệu bài làm {token} chưa khớp bản trên web.")
            for upload in attempt.uploads.all():
                if upload.file and not upload.drive_url:
                    errors.append(f"Tệp {upload.original_name} của bài làm {token} chưa có liên kết sao lưu Drive.")

    manifest = {
        "verifiedAt": timezone.now().isoformat(),
        "questionCount": len(expected_question_ids),
        "attemptCount": len(expected_attempt_tokens),
        "questionHash": hashlib.sha256(_canonical(assessment.questions or []).encode("utf-8")).hexdigest(),
        "errors": errors[:100],
    }
    assessment.backup_manifest = manifest
    if errors:
        assessment.sync_status = "error"
        assessment.sync_error = " ".join(errors[:5])[:2000]
        assessment.save(update_fields=["backup_manifest", "sync_status", "sync_error", "updated_at"])
        return False, manifest
    assessment.status = "backup_complete"
    assessment.backup_completed_at = timezone.now()
    assessment.backup_retry_at = None
    assessment.sync_status = "synced"
    assessment.sync_error = ""
    assessment.attempts.exclude(status="in_progress").update(sync_status="synced", sync_error="", synced_at=timezone.now())
    assessment.save(update_fields=["status", "backup_completed_at", "backup_retry_at", "backup_manifest", "sync_status", "sync_error", "updated_at"])
    return True, manifest


def auto_backup_graded_assessment(assessment):
    """Back up a fully graded assessment now and schedule a daily retry on failure."""
    if assessment.status != "graded" or assessment.trashed_at:
        return False
    try:
        complete, _ = verify_assessment_backup(assessment, rebuild=True)
    except Exception as error:
        complete = False
        assessment.sync_status = "error"
        assessment.sync_error = str(error)[:2000]
    if complete:
        return True
    assessment.backup_retry_at = timezone.now() + BACKUP_RETRY_DELAY
    assessment.save(update_fields=["sync_status", "sync_error", "backup_retry_at", "updated_at"])
    graded_stamp = int((assessment.graded_at or timezone.now()).timestamp())
    notify_workspace(
        event_key=f"assessment:{assessment.pk}:auto-backup-failed:{graded_stamp}",
        title="Sao lưu bài kiểm tra chưa thành công",
        message=(
            f"Bài “{assessment.title}” đã chấm xong nhưng chưa thể hoàn tất sao lưu Google Sheet/Drive. "
            "Hệ thống sẽ tự động thử lại hằng ngày; vui lòng kiểm tra nếu cảnh báo tiếp tục xuất hiện."
        ),
        severity="warning", category="digital-training", target_modules=["digital-training"],
        action_url=f"/training-assessments/{assessment.pk}",
    )
    return False


def refresh_and_backup_assessment(assessment):
    """Refresh grading state and immediately secure the final graded dataset."""
    refresh_assessment_status(assessment)
    if assessment.status == "graded":
        auto_backup_graded_assessment(assessment)
    return assessment


def lifecycle_warning(assessment, now=None):
    now = now or timezone.now()
    anchor = assessment_retention_anchor(assessment)
    if not anchor or assessment.trashed_at:
        return None
    days = max(0, (now.date() - anchor.date()).days)
    remaining = max(0, RETENTION_DELETE_DAY - days)
    if days >= 28:
        return {"level": "urgent", "label": f"Dữ liệu sẽ bị xóa sau {remaining} ngày", "days": days, "remaining": remaining}
    if assessment.status == "closed" and days >= 21:
        return {"level": "strong", "label": f"Chưa chấm · dữ liệu sẽ bị xóa sau {remaining} ngày", "days": days, "remaining": remaining}
    if assessment.status == "closed" and days >= 14:
        return {"level": "warning", "label": "Hãy chấm bài", "days": days, "remaining": remaining}
    return None


def emit_lifecycle_notification(assessment, warning):
    organization = assessment.partner.name if assessment.partner else "chưa xác định"
    anchor = assessment_retention_anchor(assessment)
    work_date = (assessment.opens_at or assessment.created_at).astimezone().strftime("%d/%m/%Y")
    if warning["days"] >= 28:
        next_action = {
            "closed": "Vui lòng hoàn tất chấm bài và sao lưu.",
            "graded": "Vui lòng hoàn tất sao lưu.",
            "backup_complete": "Bản sao lưu đã hoàn tất.",
        }.get(assessment.status, "Vui lòng kiểm tra dữ liệu.")
        message = f"Bài kiểm tra cuối khóa tập huấn của đơn vị {organization} làm ngày {work_date} sẽ bị xóa sau {warning['remaining']} ngày. {next_action}"
        milestone = 28
    elif warning["days"] >= 21:
        message = f"Bài kiểm tra cuối khóa tập huấn của đơn vị {organization} làm ngày {work_date} vẫn chưa được chấm; dữ liệu sẽ bị xóa sau {warning['remaining']} ngày."
        milestone = 21
    else:
        message = f"Bài kiểm tra cuối khóa tập huấn của đơn vị {organization} làm ngày {work_date} hiện vẫn chưa được chấm, vui lòng kiểm tra và chấm bài."
        milestone = 14
    notify_workspace(
        event_key=f"assessment:{assessment.pk}:retention:{int(anchor.timestamp())}:{milestone}",
        title=warning["label"], message=message,
        severity="urgent" if milestone >= 21 else "warning",
        category="digital-training", target_modules=["digital-training"],
        action_url=f"/training-assessments/{assessment.pk}",
    )


def trash_draft(assessment):
    now = timezone.now()
    assessment.trashed_at = now
    assessment.purge_at = now + timedelta(days=DRAFT_TRASH_DAYS)
    assessment.save(update_fields=["trashed_at", "purge_at", "updated_at"])


def close_due_assessments(now=None):
    """Close scheduled tests and finish active attempts at their actual deadline."""
    now = now or timezone.now()
    closed = 0
    due_ids = list(TrainingAssessment.objects.filter(
        status="published", trashed_at__isnull=True, closes_at__lte=now,
    ).values_list("pk", flat=True))
    for assessment_id in due_ids:
        with transaction.atomic():
            assessment = TrainingAssessment.objects.select_for_update().filter(
                pk=assessment_id, status="published", trashed_at__isnull=True, closes_at__lte=now,
            ).first()
            if not assessment:
                continue
            timed_out_ids = []
            for attempt in assessment.attempts.select_for_update().filter(status="in_progress"):
                grade_attempt(attempt)
                attempt.status = "timed_out"
                attempt.submitted_at = min(attempt.expires_at, assessment.closes_at)
                attempt.save(update_fields=[
                    "score", "max_score", "auto_graded_points", "manual_grading_required",
                    "status", "submitted_at", "updated_at",
                ])
                timed_out_ids.append(attempt.pk)
            assessment.status = "closed"
            assessment.save(update_fields=["status", "updated_at"])
            start_retention_counter(assessment, assessment.closes_at)
        for attempt in assessment.attempts.filter(pk__in=timed_out_ids):
            if not assessment.output_sheet_url:
                continue
            try:
                sync_attempt_to_google_sheet(attempt)
                attempt.sync_status = "synced"
                attempt.sync_error = ""
                attempt.synced_at = timezone.now()
            except Exception as error:
                logger.exception("Could not sync timed-out assessment attempt %s", attempt.pk)
                attempt.sync_status = "error"
                attempt.sync_error = str(error)[:2000]
            attempt.save(update_fields=["sync_status", "sync_error", "synced_at", "updated_at"])
        notify_workspace(
            event_key=f"assessment:{assessment.pk}:closed:{int(assessment.closes_at.timestamp())}",
            title="Bài kiểm tra đã đóng",
            message=f"“{assessment.title}” đã đóng theo lịch và sẵn sàng để chấm.",
            category="digital-training", target_modules=["digital-training"],
            action_url=f"/training-assessments/{assessment.pk}",
        )
        closed += 1
    return closed


def run_assessment_lifecycle(now=None):
    now = now or timezone.now()
    result = {"closed": close_due_assessments(now), "warned": 0, "backedUp": 0, "deleted": 0, "failedBackup": 0, "trashed": 0, "purgedDrafts": 0}

    # Back up every newly graded assessment as soon as possible. This also
    # catches legacy rows that reached "graded" before automatic backup was
    # introduced. Failed backups are retried once a day without scanning
    # unrelated organizations or open assessments.
    retryable_graded = TrainingAssessment.objects.select_related("partner").filter(
        status="graded", trashed_at__isnull=True,
    ).filter(
        Q(backup_retry_at__isnull=True) | Q(backup_retry_at__lte=now),
    )
    for assessment in retryable_graded.iterator():
        anchor = assessment_retention_anchor(assessment)
        if anchor and (now.date() - anchor.date()).days >= RETENTION_DELETE_DAY:
            continue
        if auto_backup_graded_assessment(assessment):
            result["backedUp"] += 1
        else:
            result["failedBackup"] += 1

    due = TrainingAssessment.objects.select_related("partner").filter(
        status__in=["closed", "graded", "backup_complete"],
        trashed_at__isnull=True,
        next_lifecycle_at__lte=now,
    )
    for assessment in due.iterator():
        refresh_assessment_status(assessment)
        warning = lifecycle_warning(assessment, now)
        if warning:
            emit_lifecycle_notification(assessment, warning)
            result["warned"] += 1
        anchor = assessment_retention_anchor(assessment)
        if not anchor:
            continue
        days = max(0, (now.date() - anchor.date()).days)
        if days < RETENTION_DELETE_DAY:
            milestone = max((item for item in RETENTION_MILESTONES if item <= days), default=0)
            next_milestone = _next_milestone(days)
            assessment.retention_milestone = milestone
            assessment.next_lifecycle_at = anchor + timedelta(days=next_milestone) if next_milestone else None
            assessment.save(update_fields=["retention_milestone", "next_lifecycle_at", "updated_at"])
            continue
        try:
            ok, _ = verify_assessment_backup(assessment, rebuild=True)
        except Exception as error:
            ok = False
            assessment.sync_status = "error"
            assessment.sync_error = str(error)[:2000]
            assessment.save(update_fields=["sync_status", "sync_error", "updated_at"])
        if not ok:
            result["failedBackup"] += 1
            notify_workspace(
                event_key=f"assessment:{assessment.pk}:backup-failed:{int(anchor.timestamp())}:{now.date().isoformat()}",
                title="Khẩn cấp: sao lưu lỗi trước khi xóa",
                message=(
                    f"Bài “{assessment.title}” của đơn vị "
                    f"{assessment.partner.name if assessment.partner else 'chưa xác định'} đã hết 30 ngày lưu trữ. "
                    "Bản Google Sheet chưa đầy đủ nên bài đã được chuyển vào thùng rác trong 3 ngày để Admin khôi phục và xử lý."
                ),
                severity="urgent", category="digital-training", target_modules=["digital-training"],
                action_url="/training-assessments",
            )
            assessment.trashed_at = now
            assessment.purge_at = now + timedelta(days=DRAFT_TRASH_DAYS)
            assessment.next_lifecycle_at = None
            assessment.save(update_fields=["trashed_at", "purge_at", "next_lifecycle_at", "updated_at"])
            result["trashed"] += 1
            continue
        else:
            result["backedUp"] += 1
        assessment_id = assessment.pk
        title = assessment.title
        assessment.delete()
        result["deleted"] += 1
        notify_workspace(
            event_key=f"assessment:{assessment_id}:retention-deleted",
            title="Đã xóa bài kiểm tra sau 30 ngày lưu trữ",
            message=f"Bài “{title}” đã được xóa hoàn toàn khỏi hệ thống theo chính sách lưu trữ tối đa 30 ngày.",
            severity="warning", category="digital-training", target_modules=["digital-training"],
            action_url="/training-assessments",
        )
    stale_drafts = TrainingAssessment.objects.filter(trashed_at__isnull=False, purge_at__lte=now)
    result["purgedDrafts"] = stale_drafts.count()
    stale_drafts.delete()
    return result
