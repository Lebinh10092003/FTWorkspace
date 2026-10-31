"""REST API endpoints for the Publishing module."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.permissions import IsWorkspaceAuthenticated
from news_posts.models import NewsPost
from .adapters import dispatch_variant, test_channel_connection
from .models import PostPlan, PostVariant, PublishAiJob, PublishChannel
from .security import mask_config_for_display
from .service import (
    cancel_publish_ai_job,
    enqueue_publish_ai_job,
    get_publish_job_queue_position,
    update_plan_overall_status,
)

logger = logging.getLogger(__name__)


def _is_manager_or_admin(request) -> bool:
    role = str(getattr(request, "user_role", "") or getattr(request.user, "role", "") or "").upper()
    return role in {"ADMIN", "MANAGER"}


def _serialize_channel(channel: PublishChannel) -> Dict[str, Any]:
    return {
        "id": channel.id,
        "name": channel.name,
        "kind": channel.kind,
        "kindDisplay": channel.get_kind_display(),
        "isShared": channel.is_shared,
        "isActive": channel.is_active,
        "ownerEmail": channel.owner.email if channel.owner else None,
        "ownerName": channel.owner.name if channel.owner else None,
        "config": channel.get_masked_config(),
        "createdAt": channel.created_at.isoformat(),
        "updatedAt": channel.updated_at.isoformat(),
    }


def _serialize_variant(variant: PostVariant) -> Dict[str, Any]:
    return {
        "id": variant.id,
        "planId": variant.plan_id,
        "channelId": variant.channel_id,
        "channelName": variant.channel.name,
        "channelKind": variant.channel.kind,
        "channelKindDisplay": variant.channel.get_kind_display(),
        "title": variant.title,
        "content": variant.content,
        "linkUrl": variant.link_url,
        "scheduledAt": variant.scheduled_at.isoformat() if variant.scheduled_at else None,
        "status": variant.status,
        "statusDisplay": variant.get_status_display(),
        "externalPostId": variant.external_post_id,
        "externalPostUrl": variant.external_post_url,
        "errorMessage": variant.error_message,
        "retryCount": variant.retry_count,
        "publishedAt": variant.published_at.isoformat() if variant.published_at else None,
        "lastAttemptAt": variant.last_attempt_at.isoformat() if variant.last_attempt_at else None,
        "createdAt": variant.created_at.isoformat(),
        "updatedAt": variant.updated_at.isoformat(),
    }


def _serialize_plan(plan: PostPlan) -> Dict[str, Any]:
    return {
        "id": plan.id,
        "title": plan.title,
        "baseContent": plan.base_content,
        "newsPostId": plan.news_post_id,
        "creatorEmail": plan.creator.email,
        "creatorName": plan.creator.name or plan.creator.email,
        "approvedByEmail": plan.approved_by.email if plan.approved_by else None,
        "approvedByName": plan.approved_by.name if plan.approved_by else None,
        "approvedAt": plan.approved_at.isoformat() if plan.approved_at else None,
        "status": plan.status,
        "statusDisplay": plan.get_status_display(),
        "scheduledAt": plan.scheduled_at.isoformat() if plan.scheduled_at else None,
        "metaNotes": plan.meta_notes,
        "variants": [_serialize_variant(v) for v in plan.variants.select_related("channel").all()],
        "createdAt": plan.created_at.isoformat(),
        "updatedAt": plan.updated_at.isoformat(),
    }


# ==============================================================================
# CHANNELS API
# ==============================================================================

@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceAuthenticated])
def channels_list_create(request):
    """List visible channels or create a new channel."""
    is_admin = _is_manager_or_admin(request)

    if request.method == "GET":
        qs = PublishChannel.objects.filter(is_active=True)
        if not is_admin:
            # Non-admins see shared channels or channels they own
            qs = qs.filter(models_Q(is_shared=True) | models_Q(owner=request.user))
        channels = list(qs)
        return Response([_serialize_channel(ch) for ch in channels])

    # POST create
    payload = request.data or {}
    name = str(payload.get("name") or "").strip()
    kind = str(payload.get("kind") or "").strip()
    raw_config = payload.get("config") or {}
    is_shared = bool(payload.get("isShared") or payload.get("is_shared"))

    if not name or not kind:
        return Response({"error": "Vui lòng nhập tên kênh và loại kênh."}, status=status.HTTP_400_BAD_REQUEST)

    # Only managers/admins can mark a channel as shared workspace-wide
    if is_shared and not is_admin:
        is_shared = False

    channel = PublishChannel(
        name=name,
        kind=kind,
        owner=request.user,
        is_shared=is_shared,
        is_active=bool(payload.get("isActive", True)),
    )
    if isinstance(raw_config, dict):
        channel.set_config(raw_config)
    channel.save()

    return Response(_serialize_channel(channel), status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsWorkspaceAuthenticated])
def channel_detail(request, pk: int):
    """Retrieve, update, or deactivate a publish channel."""
    channel = get_object_or_404(PublishChannel, pk=pk)
    is_admin = _is_manager_or_admin(request)

    # Permission check: channel owner or admin
    if channel.owner != request.user and not is_admin:
        return Response({"error": "Bạn không có quyền chỉnh sửa kênh này."}, status=status.HTTP_403_FORBIDDEN)

    if request.method == "GET":
        return Response(_serialize_channel(channel))

    if request.method == "DELETE":
        channel.is_active = False
        channel.save(update_fields=["is_active", "updated_at"])
        return Response({"success": True, "message": "Đã ngừng kích hoạt kênh."})

    # PUT/PATCH update
    payload = request.data or {}
    if "name" in payload:
        channel.name = str(payload["name"]).strip()
    if "kind" in payload:
        channel.kind = str(payload["kind"]).strip()
    if "isShared" in payload or "is_shared" in payload:
        if is_admin:
            channel.is_shared = bool(payload.get("isShared") or payload.get("is_shared"))
    if "isActive" in payload or "is_active" in payload:
        channel.is_active = bool(payload.get("isActive") if "isActive" in payload else payload.get("is_active"))

    # Config update with mask protection
    if "config" in payload and isinstance(payload["config"], dict):
        new_config = dict(payload["config"])
        old_config = channel.get_config()

        # If a secret was submitted as masked (e.g. ••••1234), preserve the existing real value
        for key in ["access_token", "secret", "app_password", "password"]:
            if key in new_config and str(new_config[key]).startswith("••••"):
                new_config[key] = old_config.get(key, "")

        channel.set_config(new_config)

    channel.save()
    return Response(_serialize_channel(channel))


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def channel_test_connection(request, pk: int):
    """Test channel connectivity and verify credentials."""
    channel = get_object_or_404(PublishChannel, pk=pk)
    res = test_channel_connection(channel)
    code = status.HTTP_200_OK if res.get("success") else status.HTTP_400_BAD_REQUEST
    return Response(res, status=code)


# ==============================================================================
# POST PLANS API
# ==============================================================================

@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceAuthenticated])
def post_plans_list_create(request):
    """List post plans or create a new plan."""
    if request.method == "GET":
        qs = PostPlan.objects.select_related("creator", "approved_by").prefetch_related("variants__channel")

        # Optional filters
        start_date = request.query_params.get("start_date") or request.query_params.get("startDate")
        end_date = request.query_params.get("end_date") or request.query_params.get("endDate")
        plan_status = request.query_params.get("status")

        if start_date:
            qs = qs.filter(scheduled_at__gte=start_date)
        if end_date:
            qs = qs.filter(scheduled_at__lte=end_date)
        if plan_status:
            qs = qs.filter(status=plan_status)

        plans = list(qs[:100])
        return Response([_serialize_plan(p) for p in plans])

    # POST create
    payload = request.data or {}
    title = str(payload.get("title") or "").strip()
    base_content = str(payload.get("baseContent") or payload.get("base_content") or "").strip()
    news_post_id = payload.get("newsPostId") or payload.get("news_post_id")
    scheduled_at_str = payload.get("scheduledAt") or payload.get("scheduled_at")
    channel_ids = payload.get("channelIds") or payload.get("channel_ids") or []

    news_post = None
    if news_post_id:
        news_post = get_object_or_404(NewsPost, pk=news_post_id)
        if not title:
            title = news_post.title
        if not base_content:
            # Try to populate base content from NewsPost content_payload or raw_text
            cp = news_post.content_payload if isinstance(news_post.content_payload, dict) else {}
            sections_text = "\n\n".join([f"{s.get('heading', '')}\n{s.get('body', '')}" for s in cp.get("sections", []) if isinstance(s, dict)])
            base_content = sections_text or str(cp.get("raw_text") or cp.get("lead_in") or "")

    if not title:
        return Response({"error": "Vui lòng nhập tiêu đề bài đăng."}, status=status.HTTP_400_BAD_REQUEST)

    scheduled_at = None
    if scheduled_at_str:
        try:
            scheduled_at = timezone.datetime.fromisoformat(str(scheduled_at_str).replace("Z", "+00:00"))
        except (ValueError, TypeError):
            pass

    with transaction.atomic():
        plan = PostPlan.objects.create(
            title=title,
            base_content=base_content,
            news_post=news_post,
            creator=request.user,
            scheduled_at=scheduled_at,
            status=PostPlan.STATUS_DRAFT,
            meta_notes=str(payload.get("metaNotes") or payload.get("meta_notes") or ""),
        )

        # Attach initial channels
        if isinstance(channel_ids, list) and channel_ids:
            channels = PublishChannel.objects.filter(id__in=channel_ids, is_active=True)
            for ch in channels:
                PostVariant.objects.create(
                    plan=plan,
                    channel=ch,
                    title=title,
                    content=base_content,
                    scheduled_at=scheduled_at,
                    status=PostVariant.STATUS_DRAFT,
                )

    return Response(_serialize_plan(plan), status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsWorkspaceAuthenticated])
def post_plan_detail(request, pk: int):
    """Retrieve, update, or cancel a post plan."""
    plan = get_object_or_404(
        PostPlan.objects.select_related("creator", "approved_by").prefetch_related("variants__channel"),
        pk=pk,
    )
    is_admin = _is_manager_or_admin(request)

    if request.method == "GET":
        return Response(_serialize_plan(plan))

    if request.method == "DELETE":
        plan.status = PostPlan.STATUS_CANCELLED
        plan.save(update_fields=["status", "updated_at"])
        plan.variants.update(status=PostVariant.STATUS_CANCELLED)
        return Response({"success": True, "message": "Đã hủy kế hoạch bài đăng."})

    # PUT/PATCH update
    payload = request.data or {}
    modified_content = False

    if "title" in payload:
        new_title = str(payload["title"]).strip()
        if new_title != plan.title:
            plan.title = new_title
            modified_content = True

    if "baseContent" in payload or "base_content" in payload:
        new_content = str(payload.get("baseContent") if "baseContent" in payload else payload.get("base_content")).strip()
        if new_content != plan.base_content:
            plan.base_content = new_content
            modified_content = True

    if "scheduledAt" in payload or "scheduled_at" in payload:
        sched_val = payload.get("scheduledAt") if "scheduledAt" in payload else payload.get("scheduled_at")
        if sched_val:
            try:
                plan.scheduled_at = timezone.datetime.fromisoformat(str(sched_val).replace("Z", "+00:00"))
            except (ValueError, TypeError):
                pass
        else:
            plan.scheduled_at = None

    if "metaNotes" in payload or "meta_notes" in payload:
        plan.meta_notes = str(payload.get("metaNotes") or payload.get("meta_notes") or "")

    # Status transitions: user requesting approval
    if "status" in payload:
        req_status = str(payload["status"]).strip()
        if req_status == PostPlan.STATUS_PENDING_APPROVAL:
            plan.status = PostPlan.STATUS_PENDING_APPROVAL
            plan.variants.filter(status=PostVariant.STATUS_DRAFT).update(status=PostVariant.STATUS_PENDING_APPROVAL)
        elif req_status == PostPlan.STATUS_DRAFT:
            plan.status = PostPlan.STATUS_DRAFT

    # Safety: Editing content resets approval
    if modified_content and plan.invalidate_approval_if_modified():
        plan.variants.filter(status__in=[PostVariant.STATUS_APPROVED, PostVariant.STATUS_SCHEDULED]).update(
            status=PostVariant.STATUS_PENDING_APPROVAL
        )

    plan.save()
    return Response(_serialize_plan(plan))


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def post_plan_approve(request, pk: int):
    """Approve a post plan for publishing or scheduling (Manager or Admin required)."""
    if not _is_manager_or_admin(request):
        return Response(
            {"error": "Chỉ Quản lý hoặc Quản trị viên mới có thẩm quyền phê duyệt bài đăng."},
            status=status.HTTP_403_FORBIDDEN,
        )

    plan = get_object_or_404(PostPlan, pk=pk)

    with transaction.atomic():
        new_status = PostPlan.STATUS_SCHEDULED if plan.scheduled_at else PostPlan.STATUS_APPROVED
        plan.status = new_status
        plan.approved_by = request.user
        plan.approved_at = timezone.now()
        plan.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])

        # Update variants
        var_new_status = PostVariant.STATUS_SCHEDULED if plan.scheduled_at else PostVariant.STATUS_APPROVED
        plan.variants.exclude(status=PostVariant.STATUS_PUBLISHED).update(
            status=var_new_status,
            updated_at=timezone.now(),
        )

    return Response(_serialize_plan(plan))


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def post_plan_generate_variants(request, pk: int):
    """Trigger background AI job to generate tailored content for each channel."""
    plan = get_object_or_404(PostPlan, pk=pk)
    payload = request.data or {}
    channel_ids = payload.get("channelIds") or payload.get("channel_ids") or []

    job = enqueue_publish_ai_job(plan, request.user, channel_ids=channel_ids)
    pos = get_publish_job_queue_position(job)

    return Response(
        {
            "jobId": job.id,
            "status": job.status,
            "queuePosition": pos,
            "message": "Đã đưa yêu cầu AI soạn bài theo kênh vào hàng đợi.",
        },
        status=status.HTTP_202_ACCEPTED,
    )


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def post_plan_publish_now(request, pk: int):
    """Immediately dispatch all variants of an approved plan."""
    plan = get_object_or_404(PostPlan.objects.prefetch_related("variants__channel"), pk=pk)

    if plan.status not in [PostPlan.STATUS_APPROVED, PostPlan.STATUS_SCHEDULED]:
        return Response(
            {"error": "Bài đăng phải được phê duyệt trước khi xuất bản."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    results = []
    with transaction.atomic():
        for variant in plan.variants.exclude(status=PostVariant.STATUS_PUBLISHED):
            try:
                res = dispatch_variant(variant)
                variant.status = res["status"]
                variant.external_post_id = res.get("external_post_id", "")
                variant.external_post_url = res.get("external_post_url", "")
                variant.published_at = timezone.now() if res["status"] == PostVariant.STATUS_PUBLISHED else None
                variant.error_message = ""
                variant.save()
                results.append({"variantId": variant.id, "success": True, "status": variant.status})
            except Exception as exc:
                variant.status = PostVariant.STATUS_FAILED
                variant.error_message = str(exc)
                variant.save()
                results.append({"variantId": variant.id, "success": False, "error": str(exc)})

        update_plan_overall_status(plan)

    return Response({"plan": _serialize_plan(plan), "dispatched": results})


# ==============================================================================
# VARIANTS API
# ==============================================================================

@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsWorkspaceAuthenticated])
def post_variant_detail(request, pk: int):
    """Retrieve or update a specific channel variant."""
    variant = get_object_or_404(PostVariant.objects.select_related("plan", "channel"), pk=pk)

    if request.method == "GET":
        return Response(_serialize_variant(variant))

    if request.method == "DELETE":
        plan = variant.plan
        variant.delete()
        update_plan_overall_status(plan)
        return Response({"success": True, "message": "Đã xóa biến thể bài đăng."})

    payload = request.data or {}
    modified = False

    if "title" in payload:
        variant.title = str(payload["title"]).strip()
        modified = True
    if "content" in payload:
        variant.content = str(payload["content"]).strip()
        modified = True
    if "linkUrl" in payload or "link_url" in payload:
        variant.link_url = str(payload.get("linkUrl") if "linkUrl" in payload else payload.get("link_url") or "").strip()
        modified = True
    if "scheduledAt" in payload or "scheduled_at" in payload:
        sched_val = payload.get("scheduledAt") if "scheduledAt" in payload else payload.get("scheduled_at")
        if sched_val:
            try:
                variant.scheduled_at = timezone.datetime.fromisoformat(str(sched_val).replace("Z", "+00:00"))
            except (ValueError, TypeError):
                pass
        else:
            variant.scheduled_at = None

    # Safety: Editing variant resets its approval and parent plan's approval
    if modified:
        if variant.status in [PostVariant.STATUS_APPROVED, PostVariant.STATUS_SCHEDULED]:
            variant.status = PostVariant.STATUS_PENDING_APPROVAL
        if variant.plan.invalidate_approval_if_modified():
            variant.plan.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])

    variant.save()
    return Response(_serialize_variant(variant))


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def post_variant_mark_published(request, pk: int):
    """Mark a manual variant (e.g. Facebook group / Zalo group) as published by the user."""
    variant = get_object_or_404(PostVariant.objects.select_related("plan", "channel"), pk=pk)
    variant.status = PostVariant.STATUS_PUBLISHED
    variant.published_at = timezone.now()
    variant.error_message = ""
    variant.save(update_fields=["status", "published_at", "error_message", "updated_at"])

    update_plan_overall_status(variant.plan)
    return Response({"success": True, "variant": _serialize_variant(variant)})


# ==============================================================================
# AI JOBS API
# ==============================================================================

@api_view(["GET", "DELETE"])
@permission_classes([IsWorkspaceAuthenticated])
def publish_job_status(request, pk: int):
    """Check AI variant generation job status or cancel."""
    job = get_object_or_404(PublishAiJob.objects.select_related("user", "plan"), pk=pk)

    if request.method == "DELETE":
        cancelled = cancel_publish_ai_job(job, user=request.user)
        return Response({"success": cancelled, "message": "Đã hủy tác vụ AI."})

    pos = get_publish_job_queue_position(job)
    return Response({
        "id": job.id,
        "planId": job.plan_id,
        "status": job.status,
        "queuePosition": pos,
        "result": job.result if job.status == PublishAiJob.STATUS_DONE else None,
        "errorMessage": job.error_message if job.status == PublishAiJob.STATUS_FAILED else "",
        "durationSeconds": job.duration_seconds,
        "completedAt": job.completed_at.isoformat() if job.completed_at else None,
    })


# Helper import for Q lookup
from django.db.models import Q as models_Q
