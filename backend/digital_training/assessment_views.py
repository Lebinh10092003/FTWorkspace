import json
import logging
import math
import re
import secrets
import unicodedata
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from authentication.models import SystemConfig
from authentication.notifications import notify_workspace
from authentication.permissions import IsAuthenticated

from .assessment_service import (
    append_assessment_deletion_log,
    append_variants,
    assessment_google_sheet_resources,
    automatic_question_score,
    clear_attempt_from_google_sheet,
    download_assessment_file_from_drive,
    delete_assessment_file_from_drive,
    fetch_google_sheet,
    generate_variants_from_import,
    grade_attempt,
    parse_assessment_workbook,
    prepare_assessment_google_sheet,
    public_questions,
    rebuild_assessment_google_sheet_rows,
    sync_attempt_to_google_sheet,
    sync_assessment_grades_from_google_sheet,
    upload_assessment_file_to_drive,
    variants_for,
)
from .models import (
    TrainingAssessment,
    TrainingAssessmentAttempt,
    TrainingAssessmentUpload,
    TrainingQuestionBankSnapshot,
)
from .assessment_lifecycle import close_due_assessments, refresh_and_backup_assessment, start_retention_counter, trash_draft, verify_assessment_backup, wake_assessment_closer
from .serializers import (
    TrainingAssessmentAttemptSerializer,
    TrainingAssessmentSerializer,
)
from .views import _actor, _can_manage, _forbidden

logger = logging.getLogger(__name__)


def _assessment_error(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"error": message}, status=code)


def _require_confirmation_password(request):
    password = str(request.data.get("confirmation_password") or "")
    if not password:
        return _assessment_error("Vui lòng nhập mật khẩu để xác nhận thao tác.", status.HTTP_403_FORBIDDEN)
    django_user = getattr(request, "django_user", None)
    if django_user is None or not django_user.check_password(password):
        return _assessment_error("Mật khẩu xác nhận không chính xác.", status.HTTP_403_FORBIDDEN)
    return None


def _public_assessment_by_slug(slug, *, lock=False):
    queryset = TrainingAssessment.objects.select_related("session", "partner", "training_class")
    if lock:
        queryset = queryset.select_for_update()
    assessment = queryset.filter(public_slug=slug).first()
    if assessment:
        return assessment
    return next(
        (candidate for candidate in queryset.exclude(public_slug=slug) if slug in (candidate.legacy_public_slugs or [])),
        None,
    )


QUESTION_BANK_CONFIG_KEY = "digital_training_question_bank"
DEFAULT_QUESTION_BANK_URL = "https://docs.google.com/spreadsheets/d/1VtV42scPJz_Z5vGkx3dxYretBEJBLGTFfjaj-rD-bbk/edit?usp=drive_link"


def _question_bank_settings():
    config, _ = SystemConfig.objects.get_or_create(key=QUESTION_BANK_CONFIG_KEY)
    data = config.data if isinstance(config.data, dict) else {}
    return config, {"default_url": str(data.get("default_url") or DEFAULT_QUESTION_BANK_URL).strip()}


def _question_bank_key(url):
    source = str(url or "").strip()
    match = re.search(r"/(?:spreadsheets|file)/d/([a-zA-Z0-9_-]+)|[?&]id=([a-zA-Z0-9_-]+)", source)
    if match:
        return match.group(1) or match.group(2)
    return re.sub(r"[^a-z0-9]+", "-", source.casefold()).strip("-")[:255]


def _bank_normalized(value):
    text = unicodedata.normalize("NFD", str(value or "").strip().casefold().replace("đ", "d"))
    return "".join(char for char in text if unicodedata.category(char) != "Mn")


def _accepts_image_upload(question):
    """The submission type determines upload permission for every topic."""
    return question.get("type") == "file_upload"


def _question_bank_inventory(questions):
    sheets = {}
    for question in questions:
        sheet_name = str(question.get("audience_group") or "Chưa phân nhóm").strip() or "Chưa phân nhóm"
        topic_name = str(question.get("category") or "Chưa phân chủ đề").strip() or "Chưa phân chủ đề"
        sheet = sheets.setdefault(sheet_name, {
            "name": sheet_name, "total": 0, "theory": 0, "practice": 0,
            "easy": 0, "medium": 0, "hard": 0, "topics": {},
        })
        topic = sheet["topics"].setdefault(topic_name, {
            "name": topic_name, "total": 0, "theory": 0, "practice": 0,
            "easy": 0, "medium": 0, "hard": 0,
        })
        normalized_knowledge = _bank_normalized(question.get("knowledge_type"))
        normalized_difficulty = _bank_normalized(question.get("difficulty"))
        for row in (sheet, topic):
            row["total"] += 1
            if normalized_knowledge in {"ly thuyet", "theory"}:
                row["theory"] += 1
            elif normalized_knowledge in {"thuc hanh", "practice"}:
                row["practice"] += 1
            if normalized_difficulty in {"de", "easy"}:
                row["easy"] += 1
            elif normalized_difficulty in {"trung binh", "medium"}:
                row["medium"] += 1
            elif normalized_difficulty in {"kho", "hard"}:
                row["hard"] += 1
    rows = []
    for sheet in sheets.values():
        sheet["topics"] = sorted(sheet["topics"].values(), key=lambda item: _bank_normalized(item["name"]))
        rows.append(sheet)
    return {"sheets": sorted(rows, key=lambda item: _bank_normalized(item["name"]))}


def _snapshot_response(snapshot):
    inventory = snapshot.inventory if isinstance(snapshot.inventory, dict) else {}
    sheets = inventory.get("sheets") if isinstance(inventory.get("sheets"), list) else []
    return {
        "source_url": snapshot.source_url,
        "source_name": snapshot.source_name or snapshot.source_url,
        "source_type": "question_bank_cache",
        "synced_at": snapshot.synced_at,
        "question_count": snapshot.question_count,
        "available_groups": [str(item.get("name") or "").strip() for item in sheets if str(item.get("name") or "").strip()],
        "inventory": inventory,
        "errors": [],
        "warnings": [],
        "import_mode": "prepared",
    }


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def question_bank_settings(request):
    if not _can_manage(request):
        return _forbidden()
    config, settings = _question_bank_settings()
    if request.method == "GET":
        return Response(settings)

    default_url = str(request.data.get("default_url") or "").strip()
    if not default_url:
        return _assessment_error("Vui long nhap lien ket ngan hang de thi mac dinh.")
    if not re.match(r"^https?://", default_url, flags=re.IGNORECASE):
        return _assessment_error("Lien ket ngan hang de thi phai bat dau bang http:// hoac https://.")
    config.data = {**(config.data if isinstance(config.data, dict) else {}), "default_url": default_url}
    config.save(update_fields=["data"])
    return Response({"default_url": default_url})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def question_bank_snapshot(request):
    """Return the cached bank, or explicitly refresh it from Google Sheets."""
    if not _can_manage(request):
        return _forbidden()
    _, settings = _question_bank_settings()
    source_url = str(request.data.get("google_sheet_url") or request.query_params.get("google_sheet_url") or settings["default_url"]).strip()
    source_key = _question_bank_key(source_url)
    snapshot = TrainingQuestionBankSnapshot.objects.filter(source_key=source_key).first()
    if request.method == "GET":
        if not snapshot:
            return _assessment_error("Ngân hàng chưa được đồng bộ. Hãy bấm Đồng bộ ngân hàng từ Google Sheet.", status.HTTP_404_NOT_FOUND)
        return Response(_snapshot_response(snapshot))
    if not source_url:
        return _assessment_error("Vui lòng nhập liên kết ngân hàng đề thi.")
    try:
        parsed = parse_assessment_workbook(fetch_google_sheet(source_url), source_url)
        if parsed.get("errors"):
            return _assessment_error(parsed["errors"][0])
        questions = parsed.get("questions") or []
        snapshot, _ = TrainingQuestionBankSnapshot.objects.update_or_create(
            source_key=source_key,
            defaults={
                "source_url": source_url,
                "source_name": source_url,
                "inventory": _question_bank_inventory(questions),
                "question_count": len(questions),
            },
        )
        response = _snapshot_response(snapshot)
        response["warnings"] = parsed.get("warnings") or []
        return Response(response)
    except ValueError as error:
        return _assessment_error(str(error))
    except Exception as error:
        detail = str(error).strip()
        message = "Không thể đồng bộ ngân hàng. Hãy kiểm tra cấu trúc file và quyền chia sẻ."
        return _assessment_error(f"{message} Chi tiết: {detail}" if detail else message)


def _identity_text(value):
    return " ".join(str(value or "").strip().casefold().split())


def _identity_phone(value):
    return re.sub(r"\D", "", str(value or ""))


def _availability(assessment):
    now = timezone.now()
    if assessment.status == "draft":
        return "draft", "Bài đánh giá chưa được phát hành."
    if assessment.status != "published":
        return "closed", "Bài đánh giá đã đóng."
    if assessment.opens_at and now < assessment.opens_at:
        return "upcoming", "Bài đánh giá chưa đến thời gian mở."
    if assessment.closes_at and now >= assessment.closes_at:
        return "closed", "Bài đánh giá đã hết thời gian nhận bài."
    return "open", ""


def _identity_field_context(assessment):
    partner = assessment.partner
    source = " ".join([
        assessment.audience_group or "",
        partner.partner_type if partner else "",
        partner.partner_subtype if partner else "",
        partner.name if partner else "",
    ])
    normalized = _bank_normalized(source)
    is_education = any(marker in normalized for marker in ("tieu hoc", "tieuhoc", "thcs", "thpt", "truong", "giao duc"))
    return {
        "organization_field_label": "Tổ chuyên môn" if is_education else "Phòng/ban",
        "organization_context_label": "Trường" if is_education else "Cơ quan/đơn vị",
        "organization_context_value": partner.name if partner else "",
    }


def _public_assessment(assessment):
    availability, message = _availability(assessment)
    variants = variants_for(assessment)
    sample_questions = public_questions(assessment, variants[0]) if variants else []
    practical_types = {"practical_submission", "file_upload"}
    practical_question_count = sum(
        1
        for question in sample_questions
        if question.get("type") in practical_types or _bank_normalized(question.get("knowledge_type")) == "thuchanh"
    )
    return {
        "title": assessment.title,
        "slug": assessment.public_slug,
        "partner_name": assessment.partner.name if assessment.partner else "",
        "class_name": assessment.training_class.name if assessment.training_class else "",
        "session_name": assessment.session.title if assessment.session else "",
        "description": assessment.description,
        "instructions": assessment.instructions,
        "duration_minutes": assessment.duration_minutes,
        "attempt_limit": assessment.attempt_limit,
        "opens_at": assessment.opens_at,
        "closes_at": assessment.closes_at,
        "variant_count": len(variants),
        "question_count": max(
            (len(public_questions(assessment, variant)) for variant in variants),
            default=0,
        ),
        "theory_question_count": max(0, len(sample_questions) - practical_question_count),
        "practical_question_count": practical_question_count,
        "participant_count": len(assessment.participants or []),
        "requires_participant": bool(assessment.participants),
        "audience_group": assessment.audience_group,
        "availability": availability,
        "message": message,
        **_identity_field_context(assessment),
    }


def _attempt_payload(attempt, request):
    data = TrainingAssessmentAttemptSerializer(attempt, context={"request": request}).data
    data["access_token"] = str(attempt.access_token)
    data["assessment"] = _public_assessment(attempt.assessment)
    data["questions"] = public_questions(attempt.assessment, attempt.variant)
    data["auto_max_score"] = sum(
        Decimal(str(question.get("points") or 0))
        for question in attempt.assessment.questions
        if str(question.get("variant") or "Đề 1") == attempt.variant
        and automatic_question_score(question, "") is not None
    )
    return data


def _reopen_attempt_for_continuation(attempt, extra_minutes):
    """Reopen the same attempt with its answers and uploads intact."""
    now = timezone.now()
    attempt.score = None
    attempt.auto_graded_points = Decimal("0")
    attempt.practical_score = None
    attempt.grading = {}
    attempt.grading_notes = []
    attempt.manual_grading_required = False
    attempt.status = "in_progress"
    attempt.submitted_at = None
    attempt.expires_at = now + timedelta(minutes=extra_minutes)
    attempt.sync_status = "pending"
    attempt.sync_error = ""
    attempt.synced_at = None
    attempt.purge_after = None
    attempt.save(update_fields=[
        "score", "auto_graded_points", "practical_score", "grading", "grading_notes",
        "manual_grading_required", "status", "submitted_at", "expires_at",
        "sync_status", "sync_error", "synced_at", "purge_after", "updated_at",
    ])
    return attempt


def _normalized_submission_link(value):
    value = str(value or "").strip()
    if not re.match(r"^https?://", value, flags=re.IGNORECASE):
        return ""
    # Fragments and a trailing slash do not identify a different submitted work.
    value = value.split("#", 1)[0].rstrip("/")
    return value.casefold()


def _admin_attempt_payloads(attempts, request):
    """Add per-question automatic scores and same-assessment duplicate-link evidence."""
    attempts = list(attempts)
    if not attempts:
        return []
    assessment = attempts[0].assessment
    questions_by_variant = {}
    for question in assessment.questions:
        questions_by_variant.setdefault(str(question.get("variant") or "Đề 1"), []).append(question)

    link_index = {}
    attempt_links = {}
    for attempt in attempts:
        rows = []
        if attempt.status == "in_progress":
            attempt_links[attempt.id] = rows
            continue
        for question in questions_by_variant.get(attempt.variant, []):
            question_id = str(question.get("id") or "")
            answer = (attempt.answers or {}).get(question_id)
            link = answer.get("link") if isinstance(answer, dict) else (
                answer if question.get("type") in {"practical_submission", "file_upload"} else ""
            )
            normalized = _normalized_submission_link(link)
            if not normalized:
                continue
            entry = {
                "attempt_id": attempt.id,
                "respondent_name": attempt.respondent_name,
                "question_id": question_id,
                "question_order": question.get("order"),
            }
            link_index.setdefault(normalized, []).append(entry)
            rows.append((normalized, str(link), question_id))
        attempt_links[attempt.id] = rows

    serialized = TrainingAssessmentAttemptSerializer(attempts, many=True, context={"request": request}).data
    payloads = []
    for attempt, data in zip(attempts, serialized):
        automatic_grading = {}
        for question in questions_by_variant.get(attempt.variant, []):
            question_id = str(question.get("id") or "")
            awarded = automatic_question_score(question, (attempt.answers or {}).get(question_id, ""))
            if awarded is not None:
                automatic_grading[question_id] = float(awarded)
        own_rows = attempt_links.get(attempt.id, [])
        own_question_ids_by_normalized = {}
        for normalized, _link, question_id in own_rows:
            own_question_ids_by_normalized.setdefault(normalized, []).append(question_id)
        own_question_orders = {
            str(question.get("id") or ""): question.get("order")
            for question in questions_by_variant.get(attempt.variant, [])
        }
        warnings = []
        for normalized, link, question_id in own_rows:
            other_matches = [item for item in link_index.get(normalized, []) if item["attempt_id"] != attempt.id]
            if other_matches:
                warnings.append({
                    "question_id": question_id, "link": link, "matches": other_matches, "scope": "other_attempt",
                })
            same_attempt_question_ids = [
                other_id for other_id in own_question_ids_by_normalized.get(normalized, []) if other_id != question_id
            ]
            if same_attempt_question_ids:
                same_attempt_matches = [
                    {
                        "attempt_id": attempt.id,
                        "respondent_name": attempt.respondent_name,
                        "question_id": other_id,
                        "question_order": own_question_orders.get(other_id),
                    }
                    for other_id in same_attempt_question_ids
                ]
                warnings.append({
                    "question_id": question_id, "link": link, "matches": same_attempt_matches, "scope": "same_attempt",
                })
        data["automatic_grading"] = automatic_grading
        data["duplicate_link_warnings"] = warnings
        data["grading_notes"] = attempt.grading_notes or []
        payloads.append(data)
    return payloads


def _admin_attempt_payload(attempt, request):
    attempts = attempt.assessment.attempts.prefetch_related("uploads").order_by("-started_at")
    return next(item for item in _admin_attempt_payloads(attempts, request) if item["id"] == attempt.id)


def _expire_if_needed(attempt):
    if attempt.status == "in_progress" and timezone.now() >= attempt.expires_at:
        grade_attempt(attempt)
        attempt.status = "timed_out"
        attempt.submitted_at = timezone.now()
        attempt.save(update_fields=[
            "score", "max_score", "auto_graded_points", "manual_grading_required",
            "status", "submitted_at", "updated_at",
        ])
        # A timed-out attempt is still a completed submission. Previously it
        # stopped here, leaving it indefinitely in the pending-sync queue.
        _sync_completed_attempt(attempt)
    return attempt


def _sync_completed_attempt(attempt):
    """Deliver one completed attempt while keeping the database as the source of truth."""
    if not attempt.assessment.output_sheet_url:
        return attempt
    try:
        sync_attempt_to_google_sheet(attempt)
        attempt.sync_status = "synced"
        attempt.sync_error = ""
        attempt.synced_at = timezone.now()
    except Exception as error:
        attempt.sync_status = "error"
        attempt.sync_error = str(error)[:2000]
    attempt.purge_after = None
    attempt.save(update_fields=["sync_status", "sync_error", "synced_at", "purge_after", "updated_at"])
    return attempt


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def assessments(request):
    queryset = TrainingAssessment.objects.select_related("session", "partner", "training_class").filter(trashed_at__isnull=True)
    if request.method == "GET":
        close_due_assessments()
        rows = list(queryset)
        for item in rows:
            refresh_and_backup_assessment(item)
        return Response(TrainingAssessmentSerializer(rows, many=True, context={"request": request}).data)
    if not _can_manage(request):
        return _forbidden()
    serializer = TrainingAssessmentSerializer(data=request.data, context={"request": request})
    serializer.is_valid(raise_exception=True)
    item = serializer.save(created_by=_actor(request))
    wake_assessment_closer()
    notify_workspace(
        event_key=f"assessment:{item.pk}:created",
        title="Đã tạo bài kiểm tra cuối khóa",
        message=f"{_actor(request)} đã tạo “{item.title}” cho {item.partner.name if item.partner else 'đơn vị chưa xác định'}.",
        category="digital-training", target_modules=["digital-training"],
        action_url=f"/training-assessments/{item.pk}",
    )
    if item.output_sheet_url:
        try:
            prepare_assessment_google_sheet(item)
            item.sync_status = "ready"
            item.sync_error = ""
        except Exception as error:
            item.sync_status = "error"
            item.sync_error = str(error)[:2000]
        item.save(update_fields=["sync_status", "sync_error", "updated_at"])
    return Response(TrainingAssessmentSerializer(item, context={"request": request}).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def assessment_detail(request, pk):
    if request.method == "GET":
        close_due_assessments(assessment_id=pk)
    item = TrainingAssessment.objects.select_related("session", "partner", "training_class").filter(pk=pk, trashed_at__isnull=True).first()
    if not item:
        return _assessment_error("Không tìm thấy bài đánh giá.", status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        refresh_and_backup_assessment(item)
        return Response(TrainingAssessmentSerializer(item, context={"request": request}).data)
    if not _can_manage(request):
        return _forbidden()
    if request.method == "DELETE":
        if item.status == "draft":
            trash_draft(item)
            return Response({"success": True, "message": "Đã chuyển bản nháp vào thùng rác. Quản trị viên có thể khôi phục trong 3 ngày."}, status=status.HTTP_202_ACCEPTED)
        active_count = item.attempts.filter(status="in_progress").count()
        if active_count:
            password_error = _require_confirmation_password(request)
            if password_error:
                return password_error
            item.attempts.filter(status="in_progress").update(status="timed_out", submitted_at=timezone.now())
        total_attempts = item.attempts.count()
        force = str(request.data.get("force") or "").strip().lower() in {"true", "1", "yes"}
        if total_attempts and not force:
            return _assessment_error(
                f"Bài có {total_attempts} lượt đã nộp. Gửi thêm force=true để xác nhận xóa toàn bộ.",
                status.HTTP_409_CONFLICT,
            )
        item.delete()
        wake_assessment_closer()
        notify_workspace(
            event_key=f"assessment:{pk}:deleted:{int(timezone.now().timestamp())}",
            title="Đã xóa bài kiểm tra cuối khóa", message=f"{_actor(request)} đã xóa “{item.title}” cùng dữ liệu bài làm trên web.",
            severity="warning", category="digital-training", target_modules=["digital-training"],
            action_url="/training-assessments",
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
    requested_status = str(request.data.get("status") or "")
    closing = requested_status == "closed"
    reopening = requested_status == "published" and item.status in {"closed", "graded", "backup_complete"}
    if closing:
        item.attempts.filter(status="in_progress").update(status="timed_out", submitted_at=timezone.now())
    serializer = TrainingAssessmentSerializer(item, data=request.data, partial=True, context={"request": request})
    serializer.is_valid(raise_exception=True)
    updated = serializer.save()
    if reopening:
        updated.closed_at = None
        updated.graded_at = None
        updated.backup_completed_at = None
        updated.backup_retry_at = None
        updated.backup_manifest = {}
        updated.retention_started_at = None
        updated.next_lifecycle_at = None
        updated.retention_milestone = 0
        updated.save(update_fields=[
            "closed_at", "graded_at", "backup_completed_at", "backup_retry_at", "backup_manifest",
            "retention_started_at", "next_lifecycle_at", "retention_milestone", "updated_at",
        ])
    if closing:
        start_retention_counter(updated, timezone.now())
        refresh_and_backup_assessment(updated)
        notify_workspace(
            event_key=f"assessment:{updated.pk}:closed:{int(updated.retention_started_at.timestamp())}",
            title="Bài kiểm tra đã đóng", message=f"“{updated.title}” đã đóng và sẵn sàng để chấm.",
            category="digital-training", target_modules=["digital-training"],
            action_url=f"/training-assessments/{updated.pk}",
        )
    wake_assessment_closer()
    return Response(TrainingAssessmentSerializer(updated, context={"request": request}).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def assessment_add_variants(request, pk):
    """Append versions only; never reshuffle versions already being used."""
    if not _can_manage(request):
        return _forbidden()
    assessment = TrainingAssessment.objects.filter(pk=pk).first()
    if not assessment:
        return _assessment_error("Không tìm thấy bài đánh giá.", status.HTTP_404_NOT_FOUND)
    try:
        append_variants(assessment, request.data.get("count", 1))
    except ValueError as error:
        return _assessment_error(str(error))
    return Response(TrainingAssessmentSerializer(assessment, context={"request": request}).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def assessment_import_preview(request):
    if not _can_manage(request):
        return _forbidden()
    uploaded = request.FILES.get("file")
    google_url = str(request.data.get("google_sheet_url") or "").strip()
    import_mode = str(request.data.get("import_mode") or "prepared").strip()
    try:
        if import_mode == "auto_generate" and not uploaded and not google_url:
            _, settings = _question_bank_settings()
            google_url = settings["default_url"]
        if uploaded:
            if not uploaded.name.lower().endswith((".xlsx", ".xlsm")):
                return _assessment_error("Vui lòng tải file .xlsx hoặc .xlsm.")
            if uploaded.size > 10 * 1024 * 1024:
                return _assessment_error("File XLSX không được vượt quá 10 MB.")
            content = uploaded.read()
            source_name = uploaded.name
            source_type = "xlsx"
        elif google_url:
            content = fetch_google_sheet(google_url)
            source_name = google_url
            source_type = "google_sheet"
        else:
            return _assessment_error("Vui lòng chọn file XLSX hoặc nhập đường dẫn Google Sheet.")
        result = parse_assessment_workbook(content, source_name)
        # Keep location metadata separate from the concise strings retained for
        # compatibility. The admin can now jump directly to the faulty row.
        located_errors = []
        for message in result.get("errors") or []:
            match = re.match(r"^(?P<sheet>.+)!(?P<row>\d+):\s*(?P<detail>.+)$", str(message))
            if not match:
                located_errors.append({"source": source_name, "message": str(message)})
                continue
            source = f"{match.group('sheet')}!{match.group('row')}"
            question = next((item for item in result.get("questions") or [] if item.get("source") == source), {})
            located_errors.append({
                "source": source,
                "question_id": question.get("id", ""),
                "question_code": question.get("question_code", ""),
                "variant": question.get("variant", match.group("sheet")),
                "message": match.group("detail"),
            })
        result["question_errors"] = located_errors
        source_questions = result["questions"]
        available_groups = sorted({str(item.get("audience_group") or "").strip() for item in source_questions if str(item.get("audience_group") or "").strip()}, key=str.casefold)
        audience_group = str(request.data.get("audience_group") or "").strip()
        if audience_group:
            source_questions = [item for item in source_questions if str(item.get("audience_group") or "").strip().casefold() == audience_group.casefold()]
            if not source_questions:
                return _assessment_error("Nhóm đối tượng không có câu hỏi trong ngân hàng đã chọn.")
        result["bank_questions"] = source_questions
        result["available_groups"] = available_groups
        if import_mode == "auto_generate" and not result["errors"]:
            try:
                participant_count = max(0, int(request.data.get("participant_count") or 0))
                max_people = max(1, int(request.data.get("max_people_per_variant") or 12))
            except (TypeError, ValueError):
                return _assessment_error("So nguoi tham gia hoac so nguoi tren moi ma de khong hop le.")
            structure = request.data.get("structure") or []
            topic_config = request.data.get("topic_config") or []
            knowledge_config = request.data.get("knowledge_config") or {}
            score_config = request.data.get("score_config") or {}
            difficulty_config = request.data.get("difficulty_config") or {}
            if isinstance(structure, str):
                try:
                    structure = json.loads(structure)
                except json.JSONDecodeError:
                    return _assessment_error("Cơ cấu câu hỏi không đúng định dạng JSON.")
            if isinstance(topic_config, str):
                try:
                    topic_config = json.loads(topic_config)
                except json.JSONDecodeError:
                    return _assessment_error("Cơ cấu chủ đề không đúng định dạng JSON.")
            for config_name, config_value in (("knowledge_config", knowledge_config), ("score_config", score_config), ("difficulty_config", difficulty_config)):
                if isinstance(config_value, str):
                    try:
                        parsed = json.loads(config_value)
                    except json.JSONDecodeError:
                        return _assessment_error("Cấu hình tạo đề không đúng định dạng JSON.")
                    if config_name == "knowledge_config":
                        knowledge_config = parsed
                    elif config_name == "score_config":
                        score_config = parsed
                    else:
                        difficulty_config = parsed
            if not isinstance(structure, list) or not isinstance(topic_config, list) or not isinstance(knowledge_config, dict) or not isinstance(score_config, dict) or not isinstance(difficulty_config, dict):
                return _assessment_error("Cấu hình tạo đề không hợp lệ.")
            requested_variant_count = request.data.get("variant_count")
            if requested_variant_count not in (None, ""):
                try:
                    computed_variant_count = int(requested_variant_count)
                except (TypeError, ValueError):
                    return _assessment_error("Số mã đề không hợp lệ.")
            else:
                computed_variant_count = math.ceil(participant_count / max_people) if participant_count else 1
            generated = generate_variants_from_import(
                source_questions,
                computed_variant_count,
                request.data.get("questions_per_variant", 20),
                request.data.get("seed"),
                structure,
                topic_config,
                knowledge_config,
                score_config,
                difficulty_config,
            )
            result.update(generated)
            result["generation_config"].update({
                "participant_count": participant_count,
                "max_people_per_variant": max_people,
                "audience_group": audience_group,
            })
        elif import_mode != "prepared":
            return _assessment_error("Chế độ nhập câu hỏi không hợp lệ.")
        result["import_mode"] = import_mode
        result["source_type"] = source_type
        result["source_url"] = google_url
        return Response(result)
    except ValueError as error:
        return _assessment_error(str(error))
    except Exception as error:
        detail = str(error).strip()
        message = "Khong the doc du lieu ngan hang. Hay kiem tra cau truc file va quyen chia se."
        return _assessment_error(f"{message} Chi tiet: {detail}" if detail else message)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def assessment_results(request, pk):
    if not _can_manage(request):
        return _forbidden()
    assessment = TrainingAssessment.objects.filter(pk=pk).first()
    if not assessment:
        return _assessment_error("Không tìm thấy bài đánh giá.", status.HTTP_404_NOT_FOUND)
    attempts = assessment.attempts.prefetch_related("uploads").order_by("-started_at")
    return Response(_admin_attempt_payloads(attempts, request))


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def assessment_preview(request, slug):
    if not _can_manage(request):
        return _forbidden()
    assessment = _public_assessment_by_slug(slug)
    if not assessment:
        return _assessment_error("Không tìm thấy bài kiểm tra.", status.HTTP_404_NOT_FOUND)
    if request.method == "PATCH":
        original = request.data.get("original")
        edited = request.data.get("question")
        if not isinstance(original, dict) or not isinstance(edited, dict):
            return _assessment_error("Câu hỏi cập nhật không hợp lệ.")
        with transaction.atomic():
            assessment = TrainingAssessment.objects.select_for_update().get(pk=assessment.pk)
            index = next((i for i, q in enumerate(assessment.questions) if q.get("id") == original.get("id")), None)
            if index is None:
                return _assessment_error("Không tìm thấy câu hỏi.", status.HTTP_404_NOT_FOUND)
            current = assessment.questions[index]
            if current != original:
                return _assessment_error("Câu hỏi đã được thay đổi. Hãy tải lại trang trước khi sửa.", status.HTTP_409_CONFLICT)
            updated_question = {**current, **{key: edited[key] for key in ("text", "type", "points", "options", "correct_answers") if key in edited}}
            questions = list(assessment.questions)
            questions[index] = updated_question
            serializer = TrainingAssessmentSerializer(assessment, data={"questions": questions}, partial=True, context={"request": request})
            serializer.is_valid(raise_exception=True)
            serializer.save()
        return Response({"question": updated_question})
    variants = variants_for(assessment)
    requested_variant = str(request.query_params.get("variant") or "").strip()
    variant = requested_variant if requested_variant in variants else (variants[0] if variants else "")
    role = str(request.query_params.get("role") or "respondent").strip().lower()
    questions = public_questions(assessment, variant)
    if role == "creator":
        raw_by_id = {str(item.get("id") or ""): item for item in assessment.questions if str(item.get("variant") or "Đề 1") == variant}
        questions = [
            raw_by_id[str(question.get("id") or "")]
            for question in questions
        ]
    return Response({
        "assessment": _public_assessment(assessment),
        "questions": questions,
        "variant": variant,
        "variants": variants,
        "role": role,
    })


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def assessment_result_grade(request, pk, attempt_pk):
    if not _can_manage(request):
        return _forbidden()
    attempt = TrainingAssessmentAttempt.objects.filter(pk=attempt_pk, assessment_id=pk).first()
    if not attempt:
        return _assessment_error("Không tìm thấy lượt làm bài.", status.HTTP_404_NOT_FOUND)
    if attempt.assessment.status not in {"closed", "graded"}:
        return _assessment_error("Chỉ chấm bài sau khi bài kiểm tra đã đóng.")
    grading_note = str(request.data.get("grading_note") or "").strip()
    if grading_note:
        note_question_id = str(request.data.get("question_id") or "").strip()
        notes = list(attempt.grading_notes or [])
        notes.append({
            "id": secrets.token_hex(8),
            "question_id": note_question_id,
            "content": grading_note[:2000],
            "grader": getattr(request.user, "name", "") or _actor(request),
            "created_at": timezone.now().isoformat(),
        })
        attempt.grading_notes = notes[-200:]
        attempt.save(update_fields=["grading_notes", "updated_at"])
    question_scores = request.data.get("question_scores")
    if isinstance(question_scores, dict):
        questions = [
            question for question in attempt.assessment.questions
            if str(question.get("variant") or "Đề 1") == attempt.variant
        ]
        questions_by_id = {str(question.get("id")): question for question in questions}
        grading = dict(attempt.grading or {})
        for question_id, value in question_scores.items():
            question_id = str(question_id)
            question = questions_by_id.get(question_id)
            if not question:
                return _assessment_error("Có điểm chấm cho câu hỏi không thuộc bài làm này.")
            try:
                awarded = Decimal(str(value))
            except (InvalidOperation, TypeError):
                return _assessment_error(f"Điểm câu {question.get('order') or question_id} không hợp lệ.")
            maximum = Decimal(str(question.get("points") or 0))
            if awarded < 0 or awarded > maximum:
                return _assessment_error(f"Điểm câu {question.get('order') or question_id} phải từ 0 đến {maximum}.")
            grading[question_id] = float(awarded)

        total = Decimal("0")
        automatic_total = Decimal("0")
        manual_total = Decimal("0")
        maximum = Decimal("0")
        manual_pending = False
        for question in questions:
            question_id = str(question.get("id"))
            question_maximum = Decimal(str(question.get("points") or 0))
            maximum += question_maximum
            automatic = automatic_question_score(question, attempt.answers.get(question_id, ""))
            if automatic is not None:
                automatic_total += automatic
            if question_id in grading:
                awarded = Decimal(str(grading[question_id]))
            elif automatic is None:
                awarded = Decimal("0")
                manual_pending = True
            else:
                awarded = automatic
            total += awarded
            if automatic is None:
                manual_total += awarded
        attempt.grading = grading
        attempt.auto_graded_points = automatic_total
        attempt.practical_score = manual_total
        attempt.score = total
        attempt.max_score = maximum
        attempt.manual_grading_required = manual_pending
        attempt.save(update_fields=[
            "grading", "auto_graded_points", "practical_score", "score", "max_score",
            "manual_grading_required", "updated_at",
        ])
        _sync_completed_attempt(attempt)
        refresh_and_backup_assessment(attempt.assessment)
        return Response(_admin_attempt_payload(attempt, request))
    if grading_note:
        return Response(_admin_attempt_payload(attempt, request))
    try:
        score = Decimal(str(request.data.get("score")))
    except (InvalidOperation, TypeError):
        return _assessment_error("Điểm không hợp lệ.")
    if score < 0 or score > attempt.max_score:
        return _assessment_error("Điểm phải nằm trong thang điểm của bài.")
    attempt.score = score
    attempt.practical_score = max(Decimal("0"), score - (attempt.auto_graded_points or Decimal("0")))
    attempt.manual_grading_required = False
    attempt.save(update_fields=[
        "score", "practical_score", "manual_grading_required", "sync_status",
        "sync_error", "synced_at", "purge_after", "updated_at",
    ])
    _sync_completed_attempt(attempt)
    refresh_and_backup_assessment(attempt.assessment)
    return Response(_admin_attempt_payload(attempt, request))


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def assessment_result_answers(request, pk, attempt_pk):
    if not _can_manage(request):
        return _forbidden()
    changes = request.data.get("answers")
    if not isinstance(changes, dict) or not changes:
        return _assessment_error("Hãy chọn ít nhất một câu trả lời để sửa.")
    with transaction.atomic():
        attempt = TrainingAssessmentAttempt.objects.select_for_update().select_related("assessment").filter(
            pk=attempt_pk, assessment_id=pk,
        ).first()
        if not attempt:
            return _assessment_error("Không tìm thấy lượt làm bài.", status.HTTP_404_NOT_FOUND)
        questions = {
            str(question.get("id")): question
            for question in attempt.assessment.questions
            if str(question.get("variant") or "Đề 1") == attempt.variant
        }
        answers = dict(attempt.answers or {})
        grading = dict(attempt.grading or {})
        notes = list(attempt.grading_notes or [])
        changed_ids = []
        for question_id, value in changes.items():
            question_id = str(question_id)
            question = questions.get(question_id)
            if not question:
                return _assessment_error("Có câu trả lời không thuộc mã đề của lượt làm này.")
            question_type = question.get("type")
            options = question.get("options") or []
            option_keys = {str(option.get("key")) for option in options}
            if question_type in {"practical_submission", "file_upload"}:
                link = str((value.get("link") if isinstance(value, dict) else value) or "").strip()
                if link and not re.match(r"^https?://\S+$", link, flags=re.IGNORECASE):
                    return _assessment_error("Link bài thực hành phải bắt đầu bằng http:// hoặc https://.")
                existing = answers.get(question_id)
                cleaned = {**existing, "link": link} if isinstance(existing, dict) else {"link": link}
            elif question_type == "single_choice":
                cleaned = str(value or "").strip()
                if cleaned and cleaned not in option_keys:
                    return _assessment_error("Phương án trắc nghiệm không hợp lệ.")
            elif question_type == "multiple_choice":
                cleaned = [str(item).strip() for item in value] if isinstance(value, list) else []
                if any(item not in option_keys for item in cleaned):
                    return _assessment_error("Phương án trắc nghiệm không hợp lệ.")
            elif question_type == "matching":
                if not isinstance(value, dict):
                    return _assessment_error("Đáp án ghép nối không hợp lệ.")
                right_keys = {chr(65 + index) for index in range(len(options))}
                cleaned = {str(key): str(item) for key, item in value.items() if item}
                if any(key not in option_keys or item not in right_keys for key, item in cleaned.items()):
                    return _assessment_error("Cặp ghép nối không hợp lệ.")
            elif question_type == "ordering":
                cleaned = str(value or "").strip()
                if cleaned and (len(cleaned.split("-")) != len(option_keys) or set(cleaned.split("-")) != option_keys):
                    return _assessment_error("Thứ tự đáp án không hợp lệ.")
            elif question_type == "short_answer":
                cleaned = str(value or "")[:5000]
            else:
                return _assessment_error("Loại câu hỏi này chưa hỗ trợ sửa câu trả lời.")
            if answers.get(question_id) == cleaned:
                continue
            old_value = answers.get(question_id)
            answers[question_id] = cleaned
            grading.pop(question_id, None)
            changed_ids.append(question_id)
            notes.append({
                "id": secrets.token_hex(8), "question_id": question_id,
                "content": (f"{_actor(request)} đã sửa câu trả lời. "
                            f"Trước: {str(old_value)[:300]}; sau: {str(cleaned)[:300]}"),
                "grader": _actor(request), "created_at": timezone.now().isoformat(),
            })
        if not changed_ids:
            return Response(_admin_attempt_payload(attempt, request))
        attempt.answers = answers
        attempt.grading = grading
        attempt.grading_notes = notes[-200:]
        update_fields = ["answers", "grading", "grading_notes", "updated_at"]
        if attempt.status != "in_progress":
            automatic_total = Decimal("0")
            manual_total = Decimal("0")
            total = Decimal("0")
            manual_pending = False
            for question_id, question in questions.items():
                automatic = automatic_question_score(question, answers.get(question_id, ""))
                if automatic is not None:
                    automatic_total += automatic
                if question_id in grading:
                    awarded = Decimal(str(grading[question_id]))
                elif automatic is None:
                    awarded = Decimal("0")
                    manual_pending = True
                else:
                    awarded = automatic
                total += awarded
                if automatic is None:
                    manual_total += awarded
            attempt.auto_graded_points = automatic_total
            attempt.practical_score = manual_total
            attempt.score = total
            attempt.manual_grading_required = manual_pending
            attempt.sync_status = "pending"
            attempt.sync_error = ""
            attempt.synced_at = None
            update_fields.extend([
                "auto_graded_points", "practical_score", "score", "manual_grading_required",
                "sync_status", "sync_error", "synced_at",
            ])
        attempt.save(update_fields=update_fields)
        notify_workspace(
            event_key=f"assessment-attempt:{attempt.pk}:answers-edited:{secrets.token_hex(8)}",
            title="Quản trị viên đã sửa bài làm",
            message=(f"{_actor(request)} đã sửa {len(changed_ids)} câu trả lời trong lượt "
                     f"{attempt.access_token} của {attempt.respondent_name}."),
            severity="warning", category="digital-training", target_roles=["ADMIN"],
            action_url=f"/training-assessments/{pk}",
        )
    if attempt.status != "in_progress":
        _sync_completed_attempt(attempt)
        refresh_and_backup_assessment(attempt.assessment)
    return Response(_admin_attempt_payload(attempt, request))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def assessment_result_upload_content(request, pk, attempt_pk, upload_pk):
    """Serve submitted evidence to an authorized grader without exposing Drive permissions."""
    if not _can_manage(request):
        return _forbidden()
    upload = TrainingAssessmentUpload.objects.filter(
        pk=upload_pk, attempt_id=attempt_pk, attempt__assessment_id=pk,
    ).first()
    if not upload:
        return _assessment_error("Không tìm thấy tệp minh chứng.", status.HTTP_404_NOT_FOUND)
    content_type = upload.content_type or "application/octet-stream"
    if upload.file:
        return FileResponse(upload.file.open("rb"), content_type=content_type)
    if not upload.drive_file_id:
        return _assessment_error("Tệp minh chứng chưa sẵn sàng.", status.HTTP_404_NOT_FOUND)
    try:
        return HttpResponse(download_assessment_file_from_drive(upload.drive_file_id), content_type=content_type)
    except Exception as error:
        return _assessment_error(f"Không thể tải tệp minh chứng: {error}", status.HTTP_502_BAD_GATEWAY)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def assessment_result_kick(request, pk, attempt_pk):
    if not _can_manage(request):
        return _forbidden()
    password_error = _require_confirmation_password(request)
    if password_error:
        return password_error
    attempt = TrainingAssessmentAttempt.objects.filter(pk=attempt_pk, assessment_id=pk).first()
    if not attempt:
        return _assessment_error("Không tìm thấy lượt làm bài.", status.HTTP_404_NOT_FOUND)
    if attempt.status != "in_progress":
        return _assessment_error("Lượt làm này đã kết thúc.")
    grade_attempt(attempt)
    attempt.status = "timed_out"
    attempt.submitted_at = timezone.now()
    attempt.save(update_fields=[
        "score", "max_score", "auto_graded_points", "manual_grading_required",
        "status", "submitted_at", "updated_at",
    ])
    _sync_completed_attempt(attempt)
    return Response(_admin_attempt_payload(attempt, request))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def assessment_prepare_output(request, pk):
    if not _can_manage(request):
        return _forbidden()
    assessment = TrainingAssessment.objects.select_related("partner").filter(pk=pk).first()
    if not assessment:
        return _assessment_error("Không tìm thấy đợt kiểm tra.", status.HTTP_404_NOT_FOUND)
    try:
        resources = prepare_assessment_google_sheet(assessment)
        rebuild_assessment_google_sheet_rows(assessment, resources)
        assessment.attempts.filter(status__in=["submitted", "timed_out"]).update(
            sync_status="synced", sync_error="", synced_at=timezone.now(),
            purge_after=None,
        )
        assessment.sync_status = "ready"
        assessment.sync_error = ""
    except Exception as error:
        assessment.sync_status = "error"
        assessment.sync_error = str(error)[:2000]
    assessment.save(update_fields=["sync_status", "sync_error", "updated_at"])
    return Response(TrainingAssessmentSerializer(assessment, context={"request": request}).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def assessment_verify_backup(request, pk):
    if not _can_manage(request):
        return _forbidden()
    assessment = TrainingAssessment.objects.select_related("partner").filter(pk=pk, trashed_at__isnull=True).first()
    if not assessment:
        return _assessment_error("Không tìm thấy đợt kiểm tra.", status.HTTP_404_NOT_FOUND)
    try:
        complete, manifest = verify_assessment_backup(assessment, rebuild=True)
    except Exception as error:
        return _assessment_error(f"Không thể kiểm chứng bản sao Google Sheet: {error}", status.HTTP_502_BAD_GATEWAY)
    code = status.HTTP_200_OK if complete else status.HTTP_409_CONFLICT
    return Response({"complete": complete, "manifest": manifest, "assessment": TrainingAssessmentSerializer(assessment, context={"request": request}).data}, status=code)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def assessment_trash(request):
    if str(getattr(request, "user_role", "") or getattr(request.user, "role", "")) != "ADMIN":
        return _forbidden()
    rows = TrainingAssessment.objects.select_related("partner", "training_class").filter(trashed_at__isnull=False).order_by("purge_at")
    return Response(TrainingAssessmentSerializer(rows, many=True, context={"request": request}).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def assessment_restore(request, pk):
    if str(getattr(request, "user_role", "") or getattr(request.user, "role", "")) != "ADMIN":
        return _forbidden()
    assessment = TrainingAssessment.objects.filter(pk=pk, trashed_at__isnull=False, purge_at__gt=timezone.now()).first()
    if not assessment:
        return _assessment_error("Bài kiểm tra không còn trong thời hạn khôi phục 3 ngày.", status.HTTP_404_NOT_FOUND)
    assessment.trashed_at = None
    assessment.purge_at = None
    if assessment.retention_started_at and assessment.status in {"closed", "graded", "backup_complete"}:
        assessment.retention_milestone = 28
        assessment.next_lifecycle_at = timezone.now() + timedelta(days=3)
    assessment.save(update_fields=["trashed_at", "purge_at", "retention_milestone", "next_lifecycle_at", "updated_at"])
    return Response(TrainingAssessmentSerializer(assessment, context={"request": request}).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def assessment_import_sheet_grades(request, pk):
    if not _can_manage(request):
        return _forbidden()
    assessment = TrainingAssessment.objects.filter(pk=pk).first()
    if not assessment:
        return _assessment_error("Không tìm thấy đợt kiểm tra.", status.HTTP_404_NOT_FOUND)
    if not assessment.output_sheet_url:
        return _assessment_error("Bài kiểm tra chưa liên kết Google Sheet.")
    try:
        result = sync_assessment_grades_from_google_sheet(assessment)
        refresh_and_backup_assessment(assessment)
        return Response(result)
    except Exception as error:
        return _assessment_error(f"Không thể đồng bộ điểm từ Google Sheet: {error}")


@api_view(["POST", "DELETE"])
@permission_classes([IsAuthenticated])
def assessment_result_storage(request, pk, attempt_pk):
    if not _can_manage(request):
        return _forbidden()
    attempt = TrainingAssessmentAttempt.objects.select_related("assessment").filter(pk=attempt_pk, assessment_id=pk).first()
    if not attempt:
        return _assessment_error("Không tìm thấy lượt làm bài.", status.HTTP_404_NOT_FOUND)
    if request.method == "DELETE":
        password_error = _require_confirmation_password(request)
        if password_error:
            return password_error
        actor = _actor(request)
        with transaction.atomic():
            notify_workspace(
                event_key=f"assessment-attempt:{attempt.pk}:deleted",
                title="Đã xóa một lượt làm bài",
                message=(f"{actor} đã xóa lượt {attempt.access_token} của {attempt.respondent_name} "
                         f"trong bài “{attempt.assessment.title}” (trạng thái: {attempt.status}; "
                         f"đồng bộ: {attempt.sync_status})."),
                severity="warning", category="digital-training", target_roles=["ADMIN"],
                action_url="/training-assessments",
            )
            attempt.delete()
        sheet_log_warning = ""
        if attempt.assessment.output_sheet_url:
            try:
                clear_attempt_from_google_sheet(attempt)
            except Exception:
                logger.exception("Could not clear deleted assessment attempt %s from Google Sheets", attempt_pk)
                sheet_log_warning = "Đã xóa lượt làm khỏi hệ thống nhưng chưa xóa được điểm cũ trên Google Sheets. Cần kiểm tra và xóa thủ công tại bảng điểm."
            try:
                append_assessment_deletion_log(
                    attempt, actor, "Xóa thủ công",
                    f"Đã xóa khỏi hệ thống; trạng thái đồng bộ trước khi xóa: {attempt.sync_status}.",
                )
            except Exception:
                logger.exception("Could not append deletion log for assessment attempt %s", attempt_pk)
                sheet_log_warning += " Chưa ghi được nhật ký xóa lên Google Sheets."
        return Response({"sheet_log_warning": sheet_log_warning})
    if attempt.status == "in_progress":
        return _assessment_error("Chỉ đồng bộ lượt làm đã nộp hoặc đã hết giờ.")
    if not attempt.assessment.output_sheet_url:
        return _assessment_error("Bài kiểm tra chưa có Google Sheet đầu ra để đồng bộ.")
    _sync_completed_attempt(attempt)
    return Response(_admin_attempt_payload(attempt, request))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def assessment_result_reopen(request, pk, attempt_pk):
    if not _can_manage(request):
        return _forbidden()
    password_error = _require_confirmation_password(request)
    if password_error:
        return password_error
    try:
        extra_minutes = int(request.data.get("extra_minutes"))
    except (TypeError, ValueError):
        return _assessment_error("Vui lòng nhập số phút làm thêm từ 1 đến 10.080 phút.")
    if not 1 <= extra_minutes <= 10080:
        return _assessment_error("Số phút làm thêm phải từ 1 đến 10.080 phút.")
    with transaction.atomic():
        attempt = TrainingAssessmentAttempt.objects.select_for_update().select_related("assessment").filter(
            pk=attempt_pk, assessment_id=pk,
        ).first()
        if not attempt:
            return _assessment_error("Không tìm thấy lượt làm bài.", status.HTTP_404_NOT_FOUND)
        if attempt.status == "in_progress":
            return _assessment_error("Lượt này vẫn đang làm; không cần mở lại.")
        availability, _ = _availability(attempt.assessment)
        if availability != "open":
            return _assessment_error(
                "Bài kiểm tra đang đóng hoặc ngoài lịch mở. Hãy mở lại bài và gia hạn lịch trước khi mở lại lượt làm."
            )
        if attempt.assessment.closes_at and timezone.now() + timedelta(minutes=extra_minutes) > attempt.assessment.closes_at:
            return _assessment_error("Thời gian làm thêm vượt quá giờ đóng bài. Hãy gia hạn giờ đóng bài trước.")
        other_active = attempt.assessment.attempts.filter(status="in_progress").exclude(pk=attempt.pk)
        if attempt.participant_code:
            other_active = other_active.filter(participant_code__iexact=attempt.participant_code)
        else:
            other_active = other_active.filter(email__iexact=attempt.email, phone=attempt.phone)
        if other_active.exists():
            return _assessment_error("Người học đã có lượt đang làm khác. Hãy xử lý lượt đó trước.")
        previous_status = attempt.status
        previous_sync_status = attempt.sync_status
        now = timezone.now()
        if attempt.assessment.output_sheet_url:
            try:
                clear_attempt_from_google_sheet(attempt)
            except Exception:
                logger.exception("Could not clear reopened assessment attempt %s from Google Sheets", attempt.pk)
                return _assessment_error(
                    "Chưa xóa được điểm cũ trên Google Sheets nên chưa thể mở tiếp lượt này. "
                    "Vui lòng thử lại hoặc liên hệ nhân viên FermatTech để được hỗ trợ.",
                    status.HTTP_503_SERVICE_UNAVAILABLE,
                )
        _reopen_attempt_for_continuation(attempt, extra_minutes)
        notify_workspace(
            event_key=f"assessment-attempt:{attempt.pk}:reopened:{int(now.timestamp())}",
            title="Đã mở lại lượt làm bài",
            message=(f"{_actor(request)} đã cho {attempt.respondent_name} làm tiếp lượt {attempt.access_token} "
                     f"trong bài “{attempt.assessment.title}” (trước đó: {previous_status}; "
                     f"đồng bộ: {previous_sync_status}; thêm {extra_minutes} phút)."),
            severity="warning", category="digital-training", target_roles=["ADMIN"],
            action_url=f"/training-assessments/{pk}",
        )
    return Response(_admin_attempt_payload(attempt, request))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def assessment_sync_pending_results(request, pk):
    """Retry every completed record whose delivery is not confirmed yet."""
    if not _can_manage(request):
        return _forbidden()
    assessment = TrainingAssessment.objects.filter(pk=pk).first()
    if not assessment:
        return _assessment_error("Không tìm thấy đợt kiểm tra.", status.HTTP_404_NOT_FOUND)
    if not assessment.output_sheet_url:
        return _assessment_error("Bài kiểm tra chưa có Google Sheet đầu ra để đồng bộ.")
    pending = assessment.attempts.filter(
        status__in=["submitted", "timed_out"], sync_status__in=["pending", "error"],
    )
    attempted = pending.count()
    if attempted:
        try:
            # One Sheets batch write replaces one request per learner. This keeps
            # class-wide retries below the service account's write quota.
            rebuild_assessment_google_sheet_rows(
                assessment, assessment_google_sheet_resources(assessment),
            )
            now = timezone.now()
            pending.update(
                sync_status="synced", sync_error="", synced_at=now,
                purge_after=None,
            )
        except Exception as error:
            pending.update(sync_status="error", sync_error=str(error)[:2000])
    remaining = assessment.attempts.filter(
        status__in=["submitted", "timed_out"], sync_status__in=["pending", "error"],
    ).count()
    return Response({"attempted": attempted, "remaining": remaining})


@api_view(["GET"])
@permission_classes([AllowAny])
def public_assessment(request, slug):
    assessment = _public_assessment_by_slug(slug)
    if not assessment:
        return _assessment_error("Đường dẫn bài đánh giá không tồn tại.", status.HTTP_404_NOT_FOUND)
    return Response(_public_assessment(assessment))


@api_view(["POST"])
@permission_classes([AllowAny])
def public_assessment_start(request, slug):
    with transaction.atomic():
        assessment = _public_assessment_by_slug(slug, lock=True)
        if not assessment:
            return _assessment_error("Đường dẫn bài đánh giá không tồn tại.", status.HTTP_404_NOT_FOUND)
        availability, message = _availability(assessment)
        if availability != "open":
            return _assessment_error(message)
        name = str(request.data.get("respondent_name") or "").strip()
        email = str(request.data.get("email") or "").strip().lower()
        phone = str(request.data.get("phone") or "").strip()
        organization = str(request.data.get("organization") or "").strip()
        position = str(request.data.get("position") or "").strip()
        participant_code = str(request.data.get("participant_code") or "").strip()
        assigned_variant = ""
        if assessment.participants:
            participant = next((item for item in assessment.participants if (
                participant_code and str(item.get("code") or "").strip().casefold() == participant_code.casefold()
            )), None)
            if not participant:
                return _assessment_error(
                    "Không tìm thấy mã người tham gia trong danh sách. Vui lòng kiểm tra lại mã hoặc liên hệ nhân viên FermatTech để được hỗ trợ."
                )
            participant_code = str(participant.get("code") or participant_code).strip()
            name = str(participant.get("name") or name).strip()
            email = str(participant.get("email") or email).strip().lower()
            phone = str(participant.get("phone") or phone).strip()
            organization = str(participant.get("organization") or organization).strip()
            position = str(participant.get("position") or position).strip()
            assigned_variant = str(participant.get("variant") or "").strip()
        missing_fields = []
        if not name:
            missing_fields.append("họ và tên")
        if not email:
            missing_fields.append("email")
        if not phone:
            missing_fields.append("số điện thoại")
        if not organization:
            missing_fields.append("đơn vị công tác")
        if assessment.participants and not participant_code:
            missing_fields.append("mã người tham gia")
        if missing_fields:
            return _assessment_error(f"Vui lòng nhập đầy đủ: {', '.join(missing_fields)}.")
        if not name:
            return _assessment_error("Vui lòng nhập họ và tên.")
        if not email and not phone and not participant_code:
            return _assessment_error("Vui lòng nhập email hoặc số điện thoại.")
        phone = _identity_phone(phone)
        if participant_code:
            contact_attempts = assessment.attempts.filter(participant_code__iexact=participant_code)
        elif email:
            contact_attempts = assessment.attempts.filter(email__iexact=email)
        else:
            contact_attempts = assessment.attempts.filter(phone=phone)
        previous = contact_attempts
        if not assessment.participants:
            previous = [
                item for item in previous
                if _identity_text(item.respondent_name) == _identity_text(name)
                and (not email or item.email.casefold() == email.casefold())
                and (not phone or _identity_phone(item.phone) == phone)
            ]
            previous_ids = [item.pk for item in previous]
            previous = assessment.attempts.filter(pk__in=previous_ids)
            if contact_attempts.exists() and not previous.exists():
                return _assessment_error(
                    "Thông tin vừa nhập trùng email hoặc số điện thoại với lượt làm trước nhưng họ tên/thông tin khác nhau. "
                    "Vui lòng kiểm tra lại; nếu cần sửa hoặc làm lại, hãy liên hệ nhân viên FermatTech để được hỗ trợ.",
                )
        replacing_attempt = None
        active_attempt = previous.filter(status="in_progress").order_by("-started_at").first()
        if active_attempt:
            active_attempt = _expire_if_needed(active_attempt)
        if active_attempt and active_attempt.status == "in_progress":
            active_token = str(request.data.get("previous_attempt_token") or "").strip()
            if request.data.get("start_new"):
                if active_token != str(active_attempt.access_token):
                    return _assessment_error("Không xác thực được lượt cũ. Vui lòng tải lại bài hoặc liên hệ nhân viên FermatTech.")
                replacing_attempt = active_attempt
            else:
                return Response({
                    "code": "unfinished_attempt",
                    "error": "Bạn có một lượt làm chưa hoàn thành. Hãy chọn tiếp tục lượt cũ hoặc tạo lượt mới.",
                    "attempt": _attempt_payload(active_attempt, request),
                }, status=status.HTTP_409_CONFLICT)
        if not position:
            return _assessment_error("Vui lòng nhập đầy đủ: chức vụ.")
        previous_token = str(request.data.get("previous_attempt_token") or "").strip()
        retry_attempt = next(
            (item for item in previous if str(item.access_token) == previous_token), None,
        ) if previous_token else None
        if retry_attempt and retry_attempt.status in {"submitted", "timed_out"}:
            if not request.data.get("replace_previous"):
                return Response({
                    "code": "retake_confirmation_required",
                    "error": "Người này đã có bài làm. Xác nhận làm lại sẽ xóa câu trả lời và điểm cũ.",
                    "previous_score": retry_attempt.score,
                    "previous_max_score": retry_attempt.max_score,
                    "previous_auto_score": retry_attempt.auto_graded_points,
                    "previous_auto_max_score": _attempt_payload(retry_attempt, request)["auto_max_score"],
                    "manual_grading_required": retry_attempt.manual_grading_required,
                }, status=status.HTTP_409_CONFLICT)
            replacing_attempt = retry_attempt
        used_attempts = contact_attempts.exclude(pk=replacing_attempt.pk) if replacing_attempt else contact_attempts
        if used_attempts.count() >= assessment.attempt_limit:
            return _assessment_error(
                f"Bạn đã sử dụng đủ {assessment.attempt_limit} lượt làm bài. "
                "Nếu đã nộp nhầm hoặc cần làm lại, vui lòng liên hệ nhân viên FermatTech để được hỗ trợ."
            )
        variants = variants_for(assessment)
        if not variants:
            return _assessment_error("Bài đánh giá chưa có câu hỏi.")
        if assigned_variant in variants:
            variant = assigned_variant
        else:
            counts = {variant: assessment.attempts.filter(variant=variant).count() for variant in variants}
            minimum = min(counts.values())
            variant = secrets.choice([variant_name for variant_name, count in counts.items() if count == minimum])
        expires_at = timezone.now() + timedelta(minutes=assessment.duration_minutes)
        if assessment.closes_at and expires_at > assessment.closes_at:
            expires_at = assessment.closes_at
        questions = public_questions(assessment, variant)
        maximum = sum(Decimal(str(item.get("points") or 0)) for item in questions)
        attempt = TrainingAssessmentAttempt.objects.create(
            assessment=assessment,
            respondent_name=name,
            email=email,
            phone=phone,
            organization=organization,
            position=position,
            participant_code=participant_code,
            variant=variant,
            expires_at=expires_at,
            max_score=maximum,
        )
        if replacing_attempt:
            if assessment.output_sheet_url:
                try:
                    clear_attempt_from_google_sheet(replacing_attempt)
                except Exception:
                    logger.exception("Could not clear replaced assessment attempt %s from Google Sheets", replacing_attempt.pk)
                    transaction.set_rollback(True)
                    return _assessment_error(
                        "Chưa xóa được điểm cũ trên Google Sheets nên chưa thể tạo lượt mới. "
                        "Vui lòng thử lại hoặc liên hệ nhân viên FermatTech để được hỗ trợ.",
                        status.HTTP_503_SERVICE_UNAVAILABLE,
                    )
            old_pk = replacing_attempt.pk
            old_token = str(replacing_attempt.access_token)
            replacing_attempt.delete()
            notify_workspace(
                event_key=f"assessment-attempt:{old_pk}:replaced-by:{attempt.pk}",
                title="Người học đã tạo lượt làm mới",
                message=(f"{name} đã xác nhận làm lại bài “{assessment.title}”. "
                         f"Lượt cũ {old_token} đã bị xóa; lượt mới là {attempt.access_token}."),
                severity="warning", category="digital-training", target_roles=["ADMIN"],
                action_url=f"/training-assessments/{assessment.pk}",
            )
        payload = _attempt_payload(attempt, request)
        if replacing_attempt:
            payload["retake_performed"] = True
    return Response(payload, status=status.HTTP_201_CREATED)


def _clean_answer_value(value):
    if isinstance(value, list):
        return [str(item)[:500] for item in value[:20] if not isinstance(item, (dict, list))]
    if isinstance(value, dict):
        return {
            str(key)[:100]: str(item)[:5000]
            for key, item in list(value.items())[:30]
            if not isinstance(item, (dict, list))
        }
    return str(value)[:5000]


def _has_answer(question, value):
    if question.get("type") == "matching":
        return (
            isinstance(value, dict)
            and len([item for item in value.values() if str(item or "").strip()])
            == len(question.get("options") or [])
        )
    if question.get("type") == "ordering":
        return (
            isinstance(value, str)
            and len([item for item in value.split("-") if item])
            == len(question.get("options") or [])
        )
    if isinstance(value, list):
        return any(str(item or "").strip() for item in value)
    if isinstance(value, dict):
        return any(str(item or "").strip() for item in value.values())
    return bool(str(value or "").strip())


@api_view(["GET", "PATCH"])
@permission_classes([AllowAny])
def public_attempt(request, token):
    attempt = TrainingAssessmentAttempt.objects.select_related(
        "assessment", "assessment__session", "assessment__partner", "assessment__training_class"
    ).prefetch_related("uploads").filter(access_token=token).first()
    if not attempt:
        return _assessment_error("Phiên làm bài không tồn tại.", status.HTTP_404_NOT_FOUND)
    attempt = _expire_if_needed(attempt)
    if request.method == "GET":
        return Response(_attempt_payload(attempt, request))
    if attempt.status == "timed_out":
        return Response(_attempt_payload(attempt, request))
    if attempt.status != "in_progress":
        return _assessment_error("Bài đã được nộp hoặc đã hết giờ.")
    allowed_ids = {str(item.get("id")) for item in public_questions(attempt.assessment, attempt.variant)}
    incoming = request.data.get("answers")
    if isinstance(incoming, dict):
        cleaned = {
            str(key): _clean_answer_value(value)
            for key, value in incoming.items()
            if str(key) in allowed_ids
        }
        attempt.answers = {**attempt.answers, **cleaned}
    incoming_progress = request.data.get("progress")
    if isinstance(incoming_progress, dict):
        current_question_id = str(incoming_progress.get("current_question_id") or "")
        reviewed = incoming_progress.get("reviewed_question_ids") or []
        attempt.progress = {
            "current_question_id": current_question_id if current_question_id in allowed_ids else "",
            "reviewed_question_ids": [str(item) for item in reviewed if str(item) in allowed_ids][:500] if isinstance(reviewed, list) else [],
        }
    if request.data.get("submit"):
        grade_attempt(attempt)
        attempt.status = "submitted"
        attempt.submitted_at = timezone.now()
        attempt.save()
        _sync_completed_attempt(attempt)
    else:
        attempt.save(update_fields=["answers", "progress", "updated_at"])
    return Response(_attempt_payload(attempt, request))


@api_view(["POST"])
@permission_classes([AllowAny])
@parser_classes([MultiPartParser, FormParser])
def public_attempt_upload(request, token):
    attempt = TrainingAssessmentAttempt.objects.select_related("assessment").filter(access_token=token).first()
    if not attempt:
        return _assessment_error("Phiên làm bài không tồn tại.", status.HTTP_404_NOT_FOUND)
    attempt = _expire_if_needed(attempt)
    if attempt.status != "in_progress":
        return _assessment_error("Bài đã được nộp hoặc đã hết giờ.")
    question_id = str(request.data.get("question_id") or "")
    question = next(
        (item for item in public_questions(attempt.assessment, attempt.variant) if str(item.get("id")) == question_id),
        None,
    )
    if not question or question.get("type") not in {"file_upload", "practical_submission"}:
        return _assessment_error("Câu thực hành không hợp lệ.")
    if not _accepts_image_upload(question):
        return _assessment_error("Chỉ câu hỏi có kiểu “Tải tệp ảnh” mới cho phép tải ảnh; câu này nhận link chia sẻ.")
    uploaded = request.FILES.get("file")
    if not uploaded:
        return _assessment_error("Vui lòng chọn ảnh.")
    maximum_size = 5
    if uploaded.size > maximum_size * 1024 * 1024:
        return _assessment_error(f"Tệp không được vượt quá {maximum_size} MB.")
    content_type = str(uploaded.content_type or "").lower()
    if content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        return _assessment_error("Loại tệp không được hỗ trợ. Hãy dùng ảnh JPG, PNG, WEBP hoặc GIF.")
    drive_data = {}
    if attempt.assessment.drive_folder_id:
        try:
            drive_data = upload_assessment_file_to_drive(
                uploaded, attempt.assessment, attempt, question_id,
            )
        except Exception as error:
            return _assessment_error(f"Không thể tải tệp lên Google Drive: {error}")
    item = TrainingAssessmentUpload.objects.create(
        attempt=attempt,
        question_id=question_id,
        file=None if drive_data else uploaded,
        drive_file_id=drive_data.get("id", ""),
        drive_url=drive_data.get("url", ""),
        sync_status="drive" if drive_data else "local",
        original_name=uploaded.name,
        content_type=uploaded.content_type or "",
    )
    current_answer = attempt.answers.get(question_id)
    answer_payload = current_answer if isinstance(current_answer, dict) else {"link": str(current_answer or "")}
    upload_url = item.drive_url or (item.file.url if item.file else "")
    existing_ids = [part for part in str(answer_payload.get("upload_ids") or answer_payload.get("upload_id") or "").split(",") if part]
    existing_urls = [part for part in str(answer_payload.get("upload_urls") or answer_payload.get("upload_url") or "").split("\n") if part]
    answer_payload = {
        **answer_payload,
        "upload_id": str(item.id),
        "upload_file_id": item.drive_file_id,
        "upload_url": upload_url,
        "upload_ids": ",".join([*existing_ids, str(item.id)]),
        "upload_urls": "\n".join([*existing_urls, upload_url]),
    }
    attempt.answers = {**attempt.answers, question_id: answer_payload}
    attempt.save(update_fields=["answers", "updated_at"])
    return Response({
        "id": item.id, "file_id": item.drive_file_id, "name": item.original_name,
        "question_id": question_id, "url": upload_url, "content_type": item.content_type,
    }, status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
@permission_classes([AllowAny])
def public_attempt_upload_delete(request, token, upload_pk):
    attempt = TrainingAssessmentAttempt.objects.select_related("assessment").filter(access_token=token).first()
    if not attempt:
        return _assessment_error("Phiên làm bài không tồn tại.", status.HTTP_404_NOT_FOUND)
    attempt = _expire_if_needed(attempt)
    if attempt.status != "in_progress":
        return _assessment_error("Chỉ có thể xóa ảnh khi bài vẫn đang được làm.")
    upload = attempt.uploads.filter(pk=upload_pk).first()
    if not upload:
        return _assessment_error("Không tìm thấy ảnh minh chứng.", status.HTTP_404_NOT_FOUND)
    if upload.drive_file_id:
        try:
            delete_assessment_file_from_drive(upload.drive_file_id)
        except Exception as error:
            return _assessment_error(f"Không thể xóa ảnh trên Google Drive: {error}")
    question_id = upload.question_id
    if upload.file:
        upload.file.delete(save=False)
    upload.delete()
    remaining = list(attempt.uploads.filter(question_id=question_id).order_by("created_at"))
    current = (attempt.answers or {}).get(question_id)
    answer_payload = dict(current) if isinstance(current, dict) else {"link": str(current or "")}
    last = remaining[-1] if remaining else None
    last_url = (last.drive_url or (last.file.url if last and last.file else "")) if last else ""
    answer_payload.update({
        "upload_id": str(last.id) if last else "",
        "upload_file_id": last.drive_file_id if last else "",
        "upload_url": last_url,
        "upload_ids": ",".join(str(item.id) for item in remaining),
        "upload_urls": "\n".join(item.drive_url or (item.file.url if item.file else "") for item in remaining),
    })
    attempt.answers = {**(attempt.answers or {}), question_id: answer_payload}
    attempt.save(update_fields=["answers", "updated_at"])
    return Response({"deleted": upload_pk, "question_id": question_id})
