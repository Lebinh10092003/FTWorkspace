from django.db import models
from django.utils import timezone

from authentication.models import UserProfile


class FundingProposalRecord(models.Model):
    """Stable number and Drive file for one browser draft."""

    draft_id = models.UUIDField(unique=True)
    owner_email = models.EmailField()
    document_number = models.CharField(max_length=64, blank=True, default="")
    sequence_number = models.PositiveIntegerField(blank=True, null=True)
    drive_file_id = models.CharField(max_length=180, blank=True, default="")
    drive_url = models.URLField(max_length=500, blank=True, default="")
    file_title = models.CharField(max_length=255, blank=True, default="")
    proposer = models.CharField(max_length=255, blank=True, default="")
    project = models.CharField(max_length=255, blank=True, default="")
    purpose = models.TextField(blank=True, default="")
    total_amount = models.CharField(max_length=64, blank=True, default="")
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=["sequence_number"],
            name="unique_funding_proposal_number",
        )]


class FundingProposalNumberCounter(models.Model):
    last_number = models.PositiveIntegerField(default=0)


class WeeklyReport(models.Model):
    """The structured report that powers the web preview and Word download.

    Google Docs remains the human/AI authoring surface.  Keeping a structured
    copy locally lets Workspace render the report reliably without scraping a
    document in the browser or exposing Google credentials to users.
    """

    STATUS_SNAPSHOT = "snapshot"
    STATUS_PUBLISHED = "published"
    STATUS_EDITED = "edited"
    STATUS_CHOICES = [
        (STATUS_SNAPSHOT, "Đã lấy từ lịch công tác"),
        (STATUS_PUBLISHED, "Đã cập nhật từ báo cáo AI"),
        (STATUS_EDITED, "Đã chỉnh sửa"),
    ]

    report_key = models.CharField(max_length=180, unique=True)
    employee_email = models.EmailField(blank=True, default="", db_index=True)
    employee_name = models.CharField(max_length=255)
    completed_week = models.PositiveSmallIntegerField(db_index=True)
    planned_week = models.PositiveSmallIntegerField(db_index=True)
    completed_items = models.JSONField(default=list, blank=True)
    difficulties = models.JSONField(default=list, blank=True)
    planned_items = models.JSONField(default=list, blank=True)
    completed_groups = models.JSONField(default=list, blank=True)
    planned_groups = models.JSONField(default=list, blank=True)
    include_bld_task = models.BooleanField(default=True)
    edited_by_name = models.CharField(max_length=255, blank=True, default="")
    edited_by_email = models.EmailField(blank=True, default="")
    edited_at = models.DateTimeField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_SNAPSHOT)
    google_document_id = models.CharField(max_length=180, blank=True, default="")
    google_tab_id = models.CharField(max_length=180, blank=True, default="")
    source_revision = models.CharField(max_length=500, blank=True, default="")
    document_synced_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-completed_week", "employee_name"]
        indexes = [
            models.Index(fields=["completed_week", "planned_week", "employee_email"], name="weekly_report_period_email"),
        ]

    def __str__(self):
        return f"Tuần {self.completed_week}/{self.planned_week} · {self.employee_name}"

    def get_completed_groups(self):
        if self.completed_groups and isinstance(self.completed_groups, list):
            return self.completed_groups
        if self.completed_items and isinstance(self.completed_items, list):
            return [{"name": "Công việc", "items": list(self.completed_items)}]
        return [{"name": "Công việc", "items": []}]

    def get_planned_groups(self):
        if self.planned_groups and isinstance(self.planned_groups, list):
            return self.planned_groups
        if self.planned_items and isinstance(self.planned_items, list):
            return [{"name": "Công việc", "items": list(self.planned_items)}]
        return [{"name": "Công việc", "items": []}]


class AiReportJob(models.Model):
    STATUS_QUEUED = "queued"
    STATUS_RUNNING = "running"
    STATUS_DONE = "done"
    STATUS_FAILED = "failed"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_QUEUED, "Đang chờ"),
        (STATUS_RUNNING, "Đang xử lý"),
        (STATUS_DONE, "Hoàn thành"),
        (STATUS_FAILED, "Thất bại"),
        (STATUS_CANCELLED, "Đã hủy"),
    ]

    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="ai_report_jobs")
    report = models.ForeignKey(WeeklyReport, on_delete=models.CASCADE, related_name="ai_report_jobs")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_QUEUED, db_index=True)
    result = models.JSONField(default=dict, blank=True)
    error_message = models.TextField(blank=True, default="")
    duration_seconds = models.FloatField(blank=True, null=True)
    started_at = models.DateTimeField(blank=True, null=True)
    completed_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["status", "created_at"], name="ai_job_status_created"),
            models.Index(fields=["user", "status"], name="ai_job_user_status"),
        ]

    def __str__(self):
        return f"AI Job #{self.pk} · {self.user.email} · {self.status}"


class AiServiceHealth(models.Model):
    STATUS_READY = "ready"
    STATUS_AUTH_ERROR = "auth_error"
    STATUS_ERROR = "error"

    STATUS_CHOICES = [
        (STATUS_READY, "Sẵn sàng"),
        (STATUS_AUTH_ERROR, "Lỗi đăng nhập"),
        (STATUS_ERROR, "Lỗi hệ thống"),
    ]

    key = models.CharField(max_length=50, default="default", unique=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_READY)
    last_checked_at = models.DateTimeField(blank=True, null=True)
    last_ready_at = models.DateTimeField(blank=True, null=True)
    last_error_at = models.DateTimeField(blank=True, null=True)
    first_ready_at = models.DateTimeField(blank=True, null=True)
    error_message = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def get_current(cls):
        health, _ = cls.objects.get_or_create(key="default")
        return health

    def is_ready(self):
        return self.status == self.STATUS_READY

    def session_days_alive(self):
        if not self.first_ready_at:
            return 0
        end_time = self.last_error_at if self.status == self.STATUS_AUTH_ERROR and self.last_error_at else timezone.now()
        diff = end_time - self.first_ready_at
        return max(0, diff.days)

