"""Service layer handling AI variant generation jobs and scheduled post dispatching."""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from django.db import transaction
from django.utils import timezone

from authentication.models import UserProfile
from documents.ai_service import execute_ai_command
from .adapters import PublishAdapterError, dispatch_variant, is_mock_mode
from .models import PostPlan, PostVariant, PublishAiJob, PublishChannel
from .prompts import build_variant_generation_prompt, parse_and_validate_ai_variants

logger = logging.getLogger(__name__)


def enqueue_publish_ai_job(
    plan: PostPlan,
    user: UserProfile,
    channel_ids: Optional[List[int]] = None,
) -> PublishAiJob:
    """Enqueue an AI variant generation job for a post plan."""
    # Check if there is already an active job for this plan
    active_job = PublishAiJob.objects.filter(
        plan=plan,
        status__in=[PublishAiJob.STATUS_QUEUED, PublishAiJob.STATUS_RUNNING],
    ).first()
    if active_job:
        return active_job

    target_ids = list(channel_ids or [])
    if not target_ids:
        # Default to all active channels accessible to this user
        channels = PublishChannel.objects.filter(is_active=True)
        target_ids = [c.id for c in channels]

    job = PublishAiJob.objects.create(
        plan=plan,
        user=user,
        channel_ids=target_ids,
        status=PublishAiJob.STATUS_QUEUED,
    )
    return job


def get_publish_job_queue_position(job: PublishAiJob) -> Optional[int]:
    """Calculate FIFO position in the queued AI jobs list."""
    if job.status != PublishAiJob.STATUS_QUEUED:
        return None
    return (
        PublishAiJob.objects.filter(
            status=PublishAiJob.STATUS_QUEUED,
            created_at__lt=job.created_at,
        ).count()
        + 1
    )


def cancel_publish_ai_job(job: PublishAiJob, user: Optional[UserProfile] = None) -> bool:
    """Cancel an active or queued AI variant generation job."""
    if user:
        role = getattr(user, "role", "EMPLOYEE")
        if job.user != user and str(role).upper() not in {"ADMIN", "MANAGER"}:
            raise PermissionError("Bạn không có quyền hủy tác vụ này.")

    if job.status in [PublishAiJob.STATUS_QUEUED, PublishAiJob.STATUS_RUNNING]:
        job.status = PublishAiJob.STATUS_CANCELLED
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "completed_at", "updated_at"])
        return True
    return False


def process_publish_ai_job(job_id: int) -> None:
    """Execute AI variant generation, parse channel-specific outputs, and save variants."""
    try:
        job = PublishAiJob.objects.select_related("user", "plan").get(id=job_id)
    except PublishAiJob.DoesNotExist:
        return

    if job.status == PublishAiJob.STATUS_CANCELLED:
        return

    plan = job.plan
    start_time = time.monotonic()
    logger.info("Publish AI job #%d starting for user %s (plan #%d)", job.id, job.user.email, plan.id)

    try:
        channels = list(PublishChannel.objects.filter(id__in=job.channel_ids, is_active=True))
        if not channels:
            raise ValueError("Không tìm thấy kênh đăng hợp lệ nào để tạo bài viết.")

        prompt = build_variant_generation_prompt(plan, channels)
        raw_output = execute_ai_command(prompt)

        job.refresh_from_db()
        if job.status == PublishAiJob.STATUS_CANCELLED:
            logger.info("Publish AI job #%d was cancelled during execution", job.id)
            return

        parsed_variants = parse_and_validate_ai_variants(raw_output, [c.id for c in channels])

        # Save or update variants in database
        with transaction.atomic():
            for ch in channels:
                var_data = parsed_variants.get(ch.id)
                if not var_data:
                    continue

                variant, created = PostVariant.objects.get_or_create(
                    plan=plan,
                    channel=ch,
                    defaults={
                        "title": var_data.get("title", ""),
                        "content": var_data.get("content", ""),
                        "status": PostVariant.STATUS_DRAFT,
                    },
                )
                if not created:
                    variant.title = var_data.get("title", "")
                    variant.content = var_data.get("content", "")
                    if variant.status in [PostVariant.STATUS_APPROVED, PostVariant.STATUS_SCHEDULED]:
                        variant.status = PostVariant.STATUS_PENDING_APPROVAL
                    variant.save(update_fields=["title", "content", "status", "updated_at"])

            # Changing content invalidates prior plan approval
            if plan.invalidate_approval_if_modified():
                plan.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])

        duration = time.monotonic() - start_time
        job.status = PublishAiJob.STATUS_DONE
        job.result = {"variants_count": len(parsed_variants)}
        job.duration_seconds = round(duration, 2)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "result", "duration_seconds", "completed_at", "updated_at"])

        logger.info("Publish AI job #%d completed successfully in %.2fs", job.id, duration)

    except Exception as exc:
        duration = time.monotonic() - start_time
        err_msg = str(exc)
        logger.error("Publish AI job #%d failed in %.2fs: %s", job.id, duration, err_msg)

        job.refresh_from_db()
        if job.status != PublishAiJob.STATUS_CANCELLED:
            job.status = PublishAiJob.STATUS_FAILED
            job.error_message = err_msg
            job.duration_seconds = round(duration, 2)
            job.completed_at = timezone.now()
            job.save(update_fields=["status", "error_message", "duration_seconds", "completed_at", "updated_at"])


def update_plan_overall_status(plan: PostPlan) -> None:
    """Recalculate plan status based on the current state of its variants."""
    variants = list(plan.variants.all())
    if not variants:
        return

    statuses = {v.status for v in variants}

    # If all published
    if statuses == {PostVariant.STATUS_PUBLISHED}:
        plan.status = PostPlan.STATUS_PUBLISHED
    # If all failed
    elif statuses == {PostVariant.STATUS_FAILED}:
        plan.status = PostPlan.STATUS_FAILED
    # If some published and some failed
    elif PostVariant.STATUS_PUBLISHED in statuses and PostVariant.STATUS_FAILED in statuses:
        plan.status = PostPlan.STATUS_PARTIAL
    # If any published or awaiting manual
    elif PostVariant.STATUS_PUBLISHED in statuses or PostVariant.STATUS_AWAITING_MANUAL in statuses:
        if plan.status != PostPlan.STATUS_PUBLISHED:
            plan.status = PostPlan.STATUS_PARTIAL if PostVariant.STATUS_FAILED in statuses else PostPlan.STATUS_SCHEDULED

    plan.save(update_fields=["status", "updated_at"])


def run_scheduled_posts() -> Dict[str, Any]:
    """Scan and dispatch all due scheduled post variants (runs every 5 minutes via systemd timer).

    Enforces safety rules:
    - Only posts from approved plans.
    - Idempotent: uses row locks to prevent duplicate sends.
    - Max 3 retries with backoff.
    """
    now = timezone.now()
    results = {
        "scanned": 0,
        "published": 0,
        "awaiting_manual": 0,
        "failed": 0,
        "skipped": 0,
    }

    # Find variants eligible for sending
    eligible_variants = (
        PostVariant.objects.select_related("plan", "channel", "plan__creator")
        .filter(
            status=PostVariant.STATUS_SCHEDULED,
            plan__status__in=[PostPlan.STATUS_APPROVED, PostPlan.STATUS_SCHEDULED],
        )
        .order_by("scheduled_at", "id")
    )

    for variant in eligible_variants:
        # Check if due (either variant scheduled_at or plan scheduled_at <= now)
        eff_sched = variant.effective_scheduled_at()
        if eff_sched and eff_sched > now:
            continue

        results["scanned"] += 1

        # Use atomic lock on the specific variant to prevent double-publish
        with transaction.atomic():
            locked = (
                PostVariant.objects.select_for_update()
                .select_related("plan", "channel", "plan__creator")
                .filter(id=variant.id, status=PostVariant.STATUS_SCHEDULED)
                .first()
            )
            if not locked:
                results["skipped"] += 1
                continue

            # Idempotency double-check
            if locked.status == PostVariant.STATUS_PUBLISHED or locked.status == PostVariant.STATUS_PUBLISHING:
                results["skipped"] += 1
                continue

            locked.status = PostVariant.STATUS_PUBLISHING
            locked.last_attempt_at = now
            locked.retry_count += 1
            locked.save(update_fields=["status", "last_attempt_at", "retry_count", "updated_at"])

            try:
                dispatch_res = dispatch_variant(locked)
                locked.status = dispatch_res["status"]
                locked.external_post_id = dispatch_res.get("external_post_id", "")
                locked.external_post_url = dispatch_res.get("external_post_url", "")
                locked.error_message = ""
                if locked.status == PostVariant.STATUS_PUBLISHED:
                    locked.published_at = now
                    results["published"] += 1
                elif locked.status == PostVariant.STATUS_AWAITING_MANUAL:
                    results["awaiting_manual"] += 1

                locked.save(update_fields=[
                    "status", "external_post_id", "external_post_url",
                    "error_message", "published_at", "updated_at",
                ])

            except Exception as exc:
                err_msg = str(exc)
                logger.warning("Dispatch failed for variant #%d (attempt %d/3): %s", locked.id, locked.retry_count, err_msg)

                retryable = getattr(exc, "retryable", True)
                if locked.retry_count >= 3 or not retryable:
                    locked.status = PostVariant.STATUS_FAILED
                    results["failed"] += 1
                else:
                    # Return to scheduled so next 5-min timer run can retry
                    locked.status = PostVariant.STATUS_SCHEDULED

                locked.error_message = err_msg
                locked.save(update_fields=["status", "error_message", "updated_at"])

            # Update parent plan status
            update_plan_overall_status(locked.plan)

    return results
