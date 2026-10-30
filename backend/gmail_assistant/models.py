from authentication.models import UserProfile
from django.db import models


class GmailConnection(models.Model):
    """Stores per-user Gmail OAuth connection, encrypted refresh token, and preferences."""

    user = models.OneToOneField(
        UserProfile,
        on_delete=models.CASCADE,
        related_name="gmail_connection",
    )
    email = models.CharField(max_length=255)
    encrypted_refresh_token = models.TextField()
    scopes = models.CharField(
        max_length=500,
        default="https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.compose",
    )
    # AI processing is opt-in per user (default: False). When False, only lists/counts emails without sending body to AI.
    ai_enabled = models.BooleanField(default=False)
    notify_new = models.BooleanField(default=True)
    morning_scan_enabled = models.BooleanField(default=True)
    morning_time = models.CharField(max_length=5, default="08:00")  # HH:MM in Asia/Ho_Chi_Minh
    superior_contacts = models.JSONField(default=list)  # Danh sách tên / email cấp trên cần xưng em
    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_history_id = models.CharField(max_length=100, null=True, blank=True)
    last_morning_date = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "gmail_connections"
        verbose_name = "Kết nối Gmail"
        verbose_name_plural = "Kết nối Gmail"

    def __str__(self):
        return f"{self.user.email} -> Gmail: {self.email} (AI: {'Bật' if self.ai_enabled else 'Tắt'})"


class MailDigest(models.Model):
    """
    Stores email metadata and AI summary/action items.
    RAW EMAIL BODY IS NEVER STORED LONG-TERM to protect user privacy.
    """

    STATUS_NEW = "new"
    STATUS_REPLIED = "replied"
    STATUS_IGNORED = "ignored"

    PRIORITY_HIGH = "high"
    PRIORITY_NORMAL = "normal"
    PRIORITY_LOW = "low"

    RECIPIENT_ROLE_TO = "to"
    RECIPIENT_ROLE_CC = "cc"
    RECIPIENT_ROLE_OTHER = "other"
    RECIPIENT_ROLE_CHOICES = [
        (RECIPIENT_ROLE_TO, "Gửi trực tiếp"),
        (RECIPIENT_ROLE_CC, "Đồng kính gửi (CC)"),
        (RECIPIENT_ROLE_OTHER, "Khác"),
    ]

    user = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name="mail_digests",
    )
    message_id = models.CharField(max_length=255, db_index=True)
    thread_id = models.CharField(max_length=255, db_index=True)
    sender = models.CharField(max_length=255)
    sender_email = models.CharField(max_length=255, blank=True)
    subject = models.CharField(max_length=500)
    snippet = models.CharField(max_length=500, blank=True)
    received_at = models.DateTimeField(db_index=True)

    recipient_role = models.CharField(
        max_length=20,
        default=RECIPIENT_ROLE_TO,
        choices=RECIPIENT_ROLE_CHOICES,
        db_index=True,
    )
    addressed_by_name = models.BooleanField(default=False)
    match_reason = models.CharField(max_length=255, blank=True)

    priority = models.CharField(
        max_length=20,
        default=PRIORITY_NORMAL,
        choices=[(PRIORITY_HIGH, "Cao"), (PRIORITY_NORMAL, "Bình thường"), (PRIORITY_LOW, "Thấp")],
    )
    needs_reply = models.BooleanField(default=False, db_index=True)
    reply_by = models.CharField(max_length=100, blank=True)  # Gợi ý hạn phản hồi từ AI
    summary = models.TextField(blank=True)  # 3-5 dòng tóm tắt của AI
    actions = models.JSONField(default=list)  # Việc cần làm
    schedule_items = models.JSONField(default=list)  # Liên kết các đầu việc đã thêm vào lịch công tác
    status = models.CharField(
        max_length=20,
        default=STATUS_NEW,
        choices=[(STATUS_NEW, "Mới"), (STATUS_REPLIED, "Đã phản hồi"), (STATUS_IGNORED, "Bỏ qua")],
        db_index=True,
    )
    is_from_me = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "gmail_digests"
        constraints = [
            models.UniqueConstraint(fields=["user", "message_id"], name="unique_user_message_digest")
        ]
        indexes = [
            models.Index(fields=["user", "received_at"]),
            models.Index(fields=["user", "needs_reply", "status"]),
        ]
        verbose_name = "Tóm tắt email"
        verbose_name_plural = "Tóm tắt email"

    def __str__(self):
        return f"[{self.priority.upper()}] {self.subject} ({self.sender})"


class MailJob(models.Model):
    """Background AI processing job for the Gmail Assistant (processed by run_ai_queue)."""

    TYPE_SUMMARIZE = "summarize"
    TYPE_SUMMARIZE_THREAD = "summarize_thread"
    TYPE_DRAFT_REPLY = "draft_reply"
    TYPE_REPORT_NOTE = "report_note"

    STATUS_QUEUED = "queued"
    STATUS_RUNNING = "running"
    STATUS_DONE = "done"
    STATUS_FAILED = "failed"
    STATUS_CANCELLED = "cancelled"

    user = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name="mail_jobs",
    )
    job_type = models.CharField(max_length=50)
    status = models.CharField(max_length=20, default=STATUS_QUEUED, db_index=True)
    payload = models.JSONField(default=dict)
    result = models.JSONField(default=dict)
    error_message = models.TextField(blank=True)
    duration_seconds = models.FloatField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "gmail_mail_jobs"
        indexes = [
            models.Index(fields=["status", "created_at"]),
            models.Index(fields=["user", "status"]),
        ]
        verbose_name = "Tác vụ AI email"
        verbose_name_plural = "Tác vụ AI email"

    def __str__(self):
        return f"Job #{self.id} ({self.job_type}) for {self.user.email} [{self.status}]"


class MailThreadSummary(models.Model):
    """
    Stores AI analysis and summary at the THREAD level.
    RAW EMAIL BODIES ARE NEVER STORED IN DB (privacy & security).
    """

    user = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name="mail_thread_summaries",
    )
    thread_id = models.CharField(max_length=255, db_index=True)
    clean_subject = models.CharField(max_length=500, blank=True)
    summary = models.TextField(blank=True)  # 3-5 dòng tóm tắt nội dung thật
    waiting_for = models.CharField(max_length=255, blank=True)  # Đang chờ ai / tình trạng hiện tại
    needs_reply = models.BooleanField(default=False)
    priority = models.CharField(max_length=20, default="normal")
    reply_by = models.CharField(max_length=100, blank=True)
    actions = models.JSONField(default=list)  # Đầu việc của cả luồng
    last_analyzed_at = models.DateTimeField(null=True, blank=True)
    last_message_id = models.CharField(max_length=255, blank=True)
    error_message = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "gmail_thread_summaries"
        constraints = [
            models.UniqueConstraint(fields=["user", "thread_id"], name="unique_user_thread_summary")
        ]
        indexes = [
            models.Index(fields=["user", "thread_id"]),
            models.Index(fields=["user", "last_analyzed_at"]),
        ]
        verbose_name = "Tóm tắt luồng email"
        verbose_name_plural = "Tóm tắt luồng email"

    def __str__(self):
        return f"ThreadSummary [{self.thread_id}] for {self.user.email} (needs_reply={self.needs_reply})"
