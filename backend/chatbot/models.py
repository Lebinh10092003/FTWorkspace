from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any, Dict, List, Optional

from django.db import models
from django.utils import timezone

from authentication.models import UserProfile


class ChatSession(models.Model):
    """Stores the active chat session for an employee. Each employee has their own session."""
    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="chat_sessions")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["user", "-updated_at"], name="chat_session_user_updated"),
        ]

    def __str__(self):
        return f"ChatSession #{self.id} · {self.user.email}"


class ChatMessage(models.Model):
    ROLE_USER = "user"
    ROLE_ASSISTANT = "assistant"
    ROLE_SYSTEM = "system"

    ROLE_CHOICES = [
        (ROLE_USER, "Người dùng"),
        (ROLE_ASSISTANT, "Trợ lý AI"),
        (ROLE_SYSTEM, "Hệ thống"),
    ]

    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name="messages")
    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="chat_messages")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    content = models.TextField()
    links = models.JSONField(default=list, blank=True)
    tool_calls = models.JSONField(default=list, blank=True)
    tool_results = models.JSONField(default=list, blank=True)
    action_ids = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["session", "created_at"], name="chat_msg_session_created"),
            models.Index(fields=["user", "created_at"], name="chat_msg_user_created"),
        ]

    def __str__(self):
        return f"ChatMessage #{self.id} · {self.user.email} · {self.role}"


class ChatAction(models.Model):
    STATUS_PENDING = "pending"
    STATUS_EXECUTED = "executed"
    STATUS_CANCELLED = "cancelled"
    STATUS_EXPIRED = "expired"
    STATUS_FAILED = "failed"

    STATUS_CHOICES = [
        (STATUS_PENDING, "Chờ xác nhận"),
        (STATUS_EXECUTED, "Đã thực thi"),
        (STATUS_CANCELLED, "Đã hủy"),
        (STATUS_EXPIRED, "Hết hạn"),
        (STATUS_FAILED, "Thất bại"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="chat_actions")
    tool_name = models.CharField(max_length=100)
    arguments = models.JSONField(default=dict)
    preview_description = models.TextField()
    diff_summary = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    result = models.JSONField(default=dict, blank=True)
    error_message = models.TextField(blank=True, default="")
    expires_at = models.DateTimeField(db_index=True)
    executed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "status"], name="chat_act_user_status"),
        ]

    def is_expired(self) -> bool:
        return timezone.now() > self.expires_at

    def check_and_expire(self) -> bool:
        if self.status == self.STATUS_PENDING and self.is_expired():
            self.status = self.STATUS_EXPIRED
            self.save(update_fields=["status"])
            return True
        return False


class AiChatJob(models.Model):
    STATUS_QUEUED = "queued"
    STATUS_RUNNING = "running"
    STATUS_DONE = "done"
    STATUS_FAILED = "failed"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_QUEUED, "Đang chờ"),
        (STATUS_RUNNING, "Đang xử lý"),
        (STATUS_DONE, "Hoàn tất"),
        (STATUS_FAILED, "Thất bại"),
        (STATUS_CANCELLED, "Đã hủy"),
    ]

    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="ai_chat_jobs")
    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name="ai_chat_jobs")
    user_message = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_QUEUED, db_index=True)
    assistant_message = models.ForeignKey(ChatMessage, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    result_text = models.TextField(blank=True, default="")
    result_links = models.JSONField(default=list, blank=True)
    result_actions = models.JSONField(default=list, blank=True)
    error_message = models.TextField(blank=True, default="")
    duration_seconds = models.FloatField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    job_type = "chat"

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["status", "created_at"], name="chat_job_status_created"),
            models.Index(fields=["user", "status"], name="chat_job_user_status"),
        ]

    def __str__(self):
        return f"ChatJob #{self.id} · {self.user.email} · {self.status}"
