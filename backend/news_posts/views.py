"""API views for managing news posts, documents, and survey data."""

from __future__ import annotations

import logging
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.permissions import IsWorkspaceAuthenticated
from documents.models import AiServiceHealth

from .document_parser import extract_text_from_file, validate_and_truncate_files_total
from .models import NewsPost, NewsPostJob
from .service import cancel_news_post_job, enqueue_news_post_job, get_news_job_queue_position
from .survey_parser import merge_survey_summaries, parse_survey_file

logger = logging.getLogger(__name__)


def _is_owner_or_admin(request, news_post: NewsPost) -> bool:
    user_email = str(getattr(request.user, "email", "") or "").strip().lower()
    owner_email = str(news_post.owner.email or "").strip().lower()
    role = str(getattr(request, "user_role", "") or getattr(request.user, "role", "") or "").upper()
    return user_email == owner_email or role in {"ADMIN", "MANAGER"}


def _serialize_news_post(np: NewsPost) -> dict:
    return {
        "id": np.id,
        "ownerEmail": np.owner.email,
        "ownerName": np.owner.name or np.owner.email,
        "postType": np.post_type,
        "title": np.title,
        "inputPayload": np.input_payload or {},
        "surveySummary": np.survey_summary or {},
        "contentPayload": np.content_payload or {},
        "status": np.status,
        "createdAt": np.created_at.isoformat(),
        "updatedAt": np.updated_at.isoformat(),
    }


def _is_payload_empty(title: str, input_payload: dict, survey_summary: dict) -> bool:
    """Check if the draft creation payload is completely empty."""
    if title.strip():
        return False
    if not isinstance(input_payload, dict):
        return True

    # Check new fields
    notes = str(input_payload.get("notes") or "").strip()
    agenda_files = input_payload.get("agenda_files") or input_payload.get("agendaFiles") or []
    material_files = input_payload.get("material_files") or input_payload.get("materialFiles") or []
    unit_name = str(input_payload.get("unit_name") or input_payload.get("unitName") or "").strip()

    # Check legacy sessions
    sessions = input_payload.get("sessions") or []

    has_survey = bool(isinstance(survey_summary, dict) and survey_summary.get("has_survey"))

    return not (notes or agenda_files or material_files or unit_name or sessions or has_survey)


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceAuthenticated])
def news_posts_list_create(request):
    """GET: List current user's news posts. POST: Create a new draft news post (rejecting empty drafts)."""
    if request.method == "GET":
        queryset = NewsPost.objects.filter(owner=request.user).order_by("-updated_at")
        post_type = request.query_params.get("postType") or request.query_params.get("post_type")
        if post_type:
            queryset = queryset.filter(post_type=post_type)
        status_filter = request.query_params.get("status")
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        items = [_serialize_news_post(np) for np in queryset]
        return Response({
            "items": items,
            "posts": items,  # backward compatibility
            "count": len(items),
        }, status=status.HTTP_200_OK)

    # POST: Create
    payload = request.data if isinstance(request.data, dict) else {}

    # Support both camelCase and snake_case
    post_type = payload.get("postType") or payload.get("post_type") or NewsPost.TYPE_FB_TRAINING
    if post_type not in dict(NewsPost.TYPE_CHOICES):
        post_type = NewsPost.TYPE_FB_TRAINING

    title = str(payload.get("title") or "").strip()
    input_payload = payload.get("inputPayload") or payload.get("input_payload") or {}
    survey_summary = payload.get("surveySummary") or payload.get("survey_summary") or {}

    # Chặn việc tạo bản nháp rỗng
    if _is_payload_empty(title, input_payload, survey_summary):
        return Response(
            {"error": "Không thể tạo bản nháp rỗng khi chưa có nội dung, ghi chú hoặc tài liệu."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Nếu người dùng chưa đặt tiêu đề, tự suy ra tiêu đề mặc định
    if not title:
        unit = str(input_payload.get("unit_name") or input_payload.get("unitName") or "").strip()
        if unit:
            title = f"Tin bài truyền thông tại {unit}"
        else:
            title = f"Bản tin truyền thông {timezone.now().strftime('%d/%m/%Y')}"

    news_post = NewsPost.objects.create(
        owner=request.user,
        post_type=post_type,
        title=title,
        input_payload=input_payload,
        survey_summary=survey_summary,
        status=NewsPost.STATUS_DRAFT,
    )

    serialized = _serialize_news_post(news_post)
    return Response({"post": serialized, **serialized}, status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsWorkspaceAuthenticated])
def news_post_detail(request, pk: int):
    """View, update, or delete a specific news post with strict ownership check."""
    news_post = get_object_or_404(NewsPost.objects.select_related("owner"), pk=pk)

    if not _is_owner_or_admin(request, news_post):
        return Response(
            {"error": "Bạn không có quyền truy cập bản tin này."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if request.method == "GET":
        serialized = _serialize_news_post(news_post)
        return Response({"post": serialized, **serialized}, status=status.HTTP_200_OK)

    if request.method in ["PUT", "PATCH"]:
        payload = request.data if isinstance(request.data, dict) else {}

        if "title" in payload:
            news_post.title = str(payload.get("title") or "").strip()

        pt = payload.get("postType") or payload.get("post_type")
        if pt and pt in dict(NewsPost.TYPE_CHOICES):
            news_post.post_type = pt

        inp = payload.get("inputPayload") if "inputPayload" in payload else payload.get("input_payload")
        if isinstance(inp, dict):
            news_post.input_payload = inp

        sur = payload.get("surveySummary") if "surveySummary" in payload else payload.get("survey_summary")
        if isinstance(sur, dict):
            news_post.survey_summary = sur

        cp = payload.get("contentPayload") if "contentPayload" in payload else payload.get("content_payload")
        if isinstance(cp, dict):
            news_post.content_payload = cp

        st = payload.get("status")
        if st and st in dict(NewsPost.STATUS_CHOICES):
            news_post.status = st

        news_post.save()
        serialized = _serialize_news_post(news_post)
        return Response({"post": serialized, **serialized}, status=status.HTTP_200_OK)

    if request.method == "DELETE":
        news_post.delete()
        return Response({"success": True, "message": "Đã xóa bản tin."}, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def news_post_parse_document(request):
    """Upload and extract text from .docx, .txt, or .md files."""
    uploaded_files = request.FILES.getlist("files") or request.FILES.getlist("file")
    if not uploaded_files:
        return Response({"error": "Vui lòng chọn tệp văn bản (.docx, .txt, .md)."}, status=status.HTTP_400_BAD_REQUEST)

    file_type = request.data.get("fileType") or request.data.get("file_type") or "agenda"

    parsed_files = []
    errors = []

    for uf in uploaded_files:
        try:
            file_bytes = uf.read()
            extracted = extract_text_from_file(file_bytes, uf.name, file_type=file_type)
            parsed_files.append(extracted)
        except Exception as exc:
            errors.append(f"{uf.name}: {exc}")

    if not parsed_files and errors:
        return Response({"error": "; ".join(errors)}, status=status.HTTP_400_BAD_REQUEST)

    single_file = parsed_files[0] if parsed_files else None
    return Response({
        "success": True,
        "file": single_file,
        "files": parsed_files,
        "warnings": errors if errors else [],
    }, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def news_post_parse_survey(request):
    """Upload and parse Excel (.xlsx) or CSV survey file(s), merging if multiple."""
    uploaded_files = request.FILES.getlist("files") or request.FILES.getlist("file")
    if not uploaded_files:
        return Response({"error": "Vui lòng chọn tệp khảo sát (.xlsx hoặc .csv)."}, status=status.HTTP_400_BAD_REQUEST)

    summaries = []
    errors = []

    for uf in uploaded_files:
        filename = uf.name
        fname_lower = filename.lower()
        if not (fname_lower.endswith(".xlsx") or fname_lower.endswith(".csv") or fname_lower.endswith(".xls")):
            errors.append(f"{filename}: Chỉ chấp nhận tệp khảo sát định dạng .xlsx hoặc .csv.")
            continue

        try:
            file_bytes = uf.read()
            s = parse_survey_file(file_bytes, filename)
            summaries.append(s)
        except Exception as exc:
            logger.warning("Lỗi phân tích tệp khảo sát %s: %s", filename, exc)
            errors.append(f"{filename}: {exc}")

    if not summaries and errors:
        return Response({"error": "; ".join(errors)}, status=status.HTTP_400_BAD_REQUEST)

    merged = merge_survey_summaries(summaries)
    return Response({
        "success": True,
        "summary": merged,
        "surveySummary": merged,  # backward compatibility
        "warnings": errors if errors else [],
    }, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def news_post_generate(request, pk: int):
    """Enqueue AI generation job for this news post."""
    news_post = get_object_or_404(NewsPost.objects.select_related("owner"), pk=pk)

    if not _is_owner_or_admin(request, news_post):
        return Response(
            {"error": "Bạn chỉ có thể yêu cầu soạn bài cho bản tin của chính mình."},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Kiểm tra tính hợp lệ của đầu vào
    input_payload = news_post.input_payload if isinstance(news_post.input_payload, dict) else {}
    notes = str(input_payload.get("notes") or "").strip()
    agenda_files = input_payload.get("agenda_files") or input_payload.get("agendaFiles") or []
    material_files = input_payload.get("material_files") or input_payload.get("materialFiles") or []
    sessions = input_payload.get("sessions") or []
    unit_name = str(input_payload.get("unit_name") or input_payload.get("unitName") or "").strip()

    if not (notes or agenda_files or material_files or sessions or unit_name):
        return Response(
            {"error": "Bản tin chưa có tài liệu tiến trình hoặc ghi chú để AI có thể soạn bài."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Check AI health
    health = AiServiceHealth.get_current()
    if health.status == AiServiceHealth.STATUS_AUTH_ERROR:
        return Response(
            {"error": "Hệ thống AI tạm thời gián đoạn, quản trị viên cần đăng nhập lại."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    job = enqueue_news_post_job(news_post, request.user)
    position = get_news_job_queue_position(job)

    return Response({
        "jobId": job.id,
        "status": job.status,
        "queuePosition": position,
        "createdAt": job.created_at.isoformat(),
    }, status=status.HTTP_201_CREATED if job.status == NewsPostJob.STATUS_QUEUED else status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def news_post_status(request, pk: int):
    """Check AI generation status and retrieve completed article."""
    news_post = get_object_or_404(NewsPost.objects.select_related("owner"), pk=pk)

    if not _is_owner_or_admin(request, news_post):
        return Response({"error": "Bạn không có quyền xem bản tin này."}, status=status.HTTP_403_FORBIDDEN)

    latest_job = NewsPostJob.objects.filter(news_post=news_post).order_by("-created_at").first()
    serialized = _serialize_news_post(news_post)

    return Response({
        "newsPostId": news_post.id,
        "status": news_post.status,
        "job": {
            "id": latest_job.id if latest_job else None,
            "status": latest_job.status if latest_job else None,
            "queuePosition": get_news_job_queue_position(latest_job) if latest_job else None,
            "errorMessage": latest_job.error_message if latest_job else "",
            "durationSeconds": latest_job.duration_seconds if latest_job else None,
        } if latest_job else None,
        "contentPayload": news_post.content_payload,
        "post": serialized,
    }, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def news_post_cancel(request, pk: int):
    """Cancel a pending AI generation job."""
    news_post = get_object_or_404(NewsPost.objects.select_related("owner"), pk=pk)

    if not _is_owner_or_admin(request, news_post):
        return Response({"error": "Bạn không có quyền hủy tác vụ này."}, status=status.HTTP_403_FORBIDDEN)

    active_job = NewsPostJob.objects.filter(
        news_post=news_post,
        status__in=[NewsPostJob.STATUS_QUEUED, NewsPostJob.STATUS_RUNNING],
    ).first()

    if not active_job:
        return Response({"message": "Không có tác vụ nào đang chờ xử lý."}, status=status.HTTP_200_OK)

    cancelled = cancel_news_post_job(active_job, request.user)
    return Response({"success": cancelled, "message": "Đã hủy tác vụ."}, status=status.HTTP_200_OK)
