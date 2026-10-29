"""API views for managing news posts and survey data."""

from __future__ import annotations

import logging
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.permissions import IsWorkspaceAuthenticated
from documents.models import AiServiceHealth

from .models import NewsPost, NewsPostJob
from .service import cancel_news_post_job, enqueue_news_post_job, get_news_job_queue_position
from .survey_parser import parse_survey_file

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
        "inputPayload": np.input_payload,
        "surveySummary": np.survey_summary,
        "contentPayload": np.content_payload,
        "status": np.status,
        "createdAt": np.created_at.isoformat(),
        "updatedAt": np.updated_at.isoformat(),
    }


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceAuthenticated])
def news_posts_list_create(request):
    """GET: List current user's news posts. POST: Create a new draft news post."""
    if request.method == "GET":
        queryset = NewsPost.objects.filter(owner=request.user)
        post_type = request.query_params.get("postType")
        if post_type:
            queryset = queryset.filter(post_type=post_type)
        status_filter = request.query_params.get("status")
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        items = [_serialize_news_post(np) for np in queryset]
        return Response({"items": items, "count": len(items)}, status=status.HTTP_200_OK)

    # POST: Create
    payload = request.data if isinstance(request.data, dict) else {}
    post_type = payload.get("postType") or NewsPost.TYPE_FB_TRAINING
    if post_type not in dict(NewsPost.TYPE_CHOICES):
        post_type = NewsPost.TYPE_FB_TRAINING

    title = str(payload.get("title") or "").strip()
    input_payload = payload.get("inputPayload") or {}
    survey_summary = payload.get("surveySummary") or {}

    news_post = NewsPost.objects.create(
        owner=request.user,
        post_type=post_type,
        title=title,
        input_payload=input_payload,
        survey_summary=survey_summary,
        status=NewsPost.STATUS_DRAFT,
    )

    return Response(_serialize_news_post(news_post), status=status.HTTP_201_CREATED)


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
        return Response(_serialize_news_post(news_post), status=status.HTTP_200_OK)

    if request.method in ["PUT", "PATCH"]:
        payload = request.data if isinstance(request.data, dict) else {}

        if "title" in payload:
            news_post.title = str(payload.get("title") or "").strip()
        if "postType" in payload and payload["postType"] in dict(NewsPost.TYPE_CHOICES):
            news_post.post_type = payload["postType"]
        if "inputPayload" in payload and isinstance(payload["inputPayload"], dict):
            news_post.input_payload = payload["inputPayload"]
        if "surveySummary" in payload and isinstance(payload["surveySummary"], dict):
            news_post.survey_summary = payload["surveySummary"]
        if "contentPayload" in payload and isinstance(payload["contentPayload"], dict):
            news_post.content_payload = payload["contentPayload"]
        if "status" in payload and payload["status"] in dict(NewsPost.STATUS_CHOICES):
            news_post.status = payload["status"]

        news_post.save()
        return Response(_serialize_news_post(news_post), status=status.HTTP_200_OK)

    if request.method == "DELETE":
        news_post.delete()
        return Response({"success": True, "message": "Đã xóa bản tin."}, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def news_post_parse_survey(request):
    """Upload and parse an Excel (.xlsx) or CSV survey file, returning verified statistics."""
    uploaded_file = request.FILES.get("file")
    if not uploaded_file:
        return Response({"error": "Vui lòng chọn tệp khảo sát (.xlsx hoặc .csv)."}, status=status.HTTP_400_BAD_REQUEST)

    filename = uploaded_file.name
    fname_lower = filename.lower()
    if not (fname_lower.endswith(".xlsx") or fname_lower.endswith(".csv")):
        return Response(
            {"error": "Chỉ chấp nhận tệp khảo sát định dạng .xlsx hoặc .csv."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        file_bytes = uploaded_file.read()
        summary = parse_survey_file(file_bytes, filename)
        return Response({"success": True, "summary": summary}, status=status.HTTP_200_OK)
    except Exception as exc:
        logger.warning("Lỗi phân tích tệp khảo sát: %s", exc)
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


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
