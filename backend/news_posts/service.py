"""Service module handling AI news post generation jobs in background queue."""

from __future__ import annotations

import logging
import time
from typing import Optional

from django.utils import timezone

from authentication.models import UserProfile
from documents.ai_service import execute_ai_command

from .models import NewsPost, NewsPostJob
from .prompts import build_news_post_prompt
from .validator import validate_and_sanitize_news_output

logger = logging.getLogger(__name__)


def enqueue_news_post_job(news_post: NewsPost, user: UserProfile) -> NewsPostJob:
    """Enqueue a new AI generation job for a news post."""
    # Check if there is already an active job for this news post
    active_job = NewsPostJob.objects.filter(
        news_post=news_post,
        status__in=[NewsPostJob.STATUS_QUEUED, NewsPostJob.STATUS_RUNNING],
    ).first()
    if active_job:
        return active_job

    job = NewsPostJob.objects.create(
        news_post=news_post,
        user=user,
        status=NewsPostJob.STATUS_QUEUED,
    )

    news_post.status = NewsPost.STATUS_GENERATING
    news_post.save(update_fields=["status", "updated_at"])
    return job


def get_news_job_queue_position(job: NewsPostJob) -> Optional[int]:
    """Calculate FIFO queue position of a queued job."""
    if job.status != NewsPostJob.STATUS_QUEUED:
        return None
    return (
        NewsPostJob.objects.filter(
            status=NewsPostJob.STATUS_QUEUED,
            created_at__lt=job.created_at,
        ).count()
        + 1
    )


def cancel_news_post_job(job: NewsPostJob, user: Optional[UserProfile] = None) -> bool:
    """Cancel an active or queued job."""
    if user:
        role = getattr(user, "role", "EMPLOYEE")
        if job.user != user and str(role).upper() not in {"ADMIN", "MANAGER"}:
            raise PermissionError("Bạn không có quyền hủy yêu cầu này.")

    if job.status in [NewsPostJob.STATUS_QUEUED, NewsPostJob.STATUS_RUNNING]:
        job.status = NewsPostJob.STATUS_CANCELLED
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "completed_at", "updated_at"])

        news_post = job.news_post
        if news_post.status == NewsPost.STATUS_GENERATING:
            news_post.status = NewsPost.STATUS_DRAFT
            news_post.save(update_fields=["status", "updated_at"])
        return True
    return False


def process_news_post_job(job_id: int) -> None:
    """Execute AI news post generation in worker, validate output, and save result."""
    try:
        job = NewsPostJob.objects.select_related("user", "news_post").get(id=job_id)
    except NewsPostJob.DoesNotExist:
        return

    if job.status == NewsPostJob.STATUS_CANCELLED:
        return

    news_post = job.news_post
    start_time = time.monotonic()
    logger.info("News post AI job #%d starting for user %s (news_post #%d)", job.id, job.user.email, news_post.id)

    try:
        prompt, allowed_numbers = build_news_post_prompt(news_post)
        raw_output = execute_ai_command(prompt)

        job.refresh_from_db()
        if job.status == NewsPostJob.STATUS_CANCELLED:
            logger.info("News post AI job #%d was cancelled during execution", job.id)
            return

        has_survey = bool(news_post.survey_summary.get("has_survey")) if isinstance(news_post.survey_summary, dict) else False
        result = validate_and_sanitize_news_output(
            raw_output,
            allowed_numbers=allowed_numbers,
            post_type=news_post.post_type,
            has_survey=has_survey,
        )

        duration = time.monotonic() - start_time
        job.status = NewsPostJob.STATUS_DONE
        job.result = result
        job.duration_seconds = round(duration, 2)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "result", "duration_seconds", "completed_at", "updated_at"])

        news_post.content_payload = result
        news_post.status = NewsPost.STATUS_COMPLETED
        if not news_post.title and result.get("headline"):
            news_post.title = result.get("headline")[:255]
        news_post.save(update_fields=["content_payload", "status", "title", "updated_at"])

        logger.info("News post AI job #%d completed successfully in %.2fs", job.id, duration)

    except Exception as exc:
        duration = time.monotonic() - start_time
        err_msg = str(exc)
        logger.error("News post AI job #%d failed in %.2fs: %s", job.id, duration, err_msg)

        job.refresh_from_db()
        if job.status != NewsPostJob.STATUS_CANCELLED:
            job.status = NewsPostJob.STATUS_FAILED
            job.error_message = err_msg
            job.duration_seconds = round(duration, 2)
            job.completed_at = timezone.now()
            job.save(update_fields=["status", "error_message", "duration_seconds", "completed_at", "updated_at"])

            news_post.status = NewsPost.STATUS_FAILED
            news_post.save(update_fields=["status", "updated_at"])
