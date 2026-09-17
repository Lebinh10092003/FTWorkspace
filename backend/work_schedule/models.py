import uuid

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from authentication.models import UserProfile


class WorkItem(models.Model):
    STATUS_TODO = "todo"
    STATUS_DOING = "doing"
    STATUS_COMPLETED = "completed"
    STATUS_REVIEWED = "reviewed"
    STATUS_CHOICES = [
        (STATUS_TODO, "Cần làm"),
        (STATUS_DOING, "Đang thực hiện"),
        (STATUS_COMPLETED, "Đã hoàn thành"),
        (STATUS_REVIEWED, "Đã review"),
    ]
    PRIORITY_CHOICES = [("low", "Thấp"), ("medium", "Vừa"), ("high", "Cao")]

    creator = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="created_work_items")
    executor = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="assigned_work_items")
    supporters = models.ManyToManyField(UserProfile, blank=True, related_name="supported_work_items")
    managers = models.ManyToManyField(UserProfile, blank=True, related_name="managed_work_items")
    title = models.CharField(max_length=1000)
    description = models.TextField(blank=True, default="")
    progress_note = models.CharField(max_length=1000, blank=True, default="")
    work_date = models.DateField(db_index=True)
    start_time = models.TimeField(blank=True, null=True)
    end_time = models.TimeField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_TODO, db_index=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="medium")
    priority_before_time = models.CharField(max_length=20, blank=True, null=True, choices=PRIORITY_CHOICES)
    label = models.CharField(max_length=100, blank=True, default="Công việc")
    daily_order = models.PositiveIntegerField(default=1)
    needs_revision = models.BooleanField(default=False)
    revision_count = models.PositiveIntegerField(default=0)
    revision_of = models.ForeignKey(
        "self", blank=True, null=True, on_delete=models.SET_NULL, related_name="revision_items"
    )
    training_session = models.OneToOneField(
        "digital_training.TrainingSession",
        blank=True,
        null=True,
        on_delete=models.SET_NULL,
        related_name="work_schedule_item",
    )
    review_percent = models.PositiveSmallIntegerField(
        blank=True, null=True, validators=[MinValueValidator(0), MaxValueValidator(100)]
    )
    review_note = models.CharField(max_length=1000, blank=True, default="")
    source_sheet_row = models.PositiveIntegerField(blank=True, null=True)
    source_task_index = models.PositiveIntegerField(blank=True, null=True)
    source_record_id = models.CharField(max_length=100, blank=True, default="")
    time_prefix_in_title = models.BooleanField(default=False)
    # ``None`` keeps the legacy/web-authored automatic priority behavior. A
    # boolean records an explicit bold/unbold choice made in the Sheet.
    sheet_emphasis = models.BooleanField(blank=True, null=True)
    # UTF-16 indexed bold/italic transitions for the title text. ``None`` is
    # retained for legacy rows whose rich formatting has not been captured;
    # an empty list means the title is explicitly unformatted.
    title_format_runs = models.JSONField(blank=True, null=True, default=None)
    # The Sheet is the authoritative editor for content and rich text. Keep
    # the last Sheet edit on the item so an older webhook cannot roll back a
    # newer edit when Apps Script deliveries arrive out of order.
    sheet_last_edited_at = models.DateTimeField(blank=True, null=True, db_index=True)
    sheet_last_editor_email = models.EmailField(blank=True, default="")
    sheet_last_event_id = models.CharField(max_length=64, blank=True, default="")
    sync_uid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    source_sync_hash = models.CharField(max_length=64, blank=True, default="")
    reviewed_by = models.ForeignKey(
        UserProfile, blank=True, null=True, on_delete=models.SET_NULL, related_name="reviewed_work_items"
    )
    reviewed_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["work_date", "daily_order", "start_time", "created_at"]
        indexes = [
            models.Index(fields=["executor", "work_date", "status"], name="work_executor_date_status_idx"),
            models.Index(fields=["creator", "work_date"], name="work_creator_date_idx"),
        ]

    def save(self, *args, **kwargs):
        from .sheet_parser import is_personal_task
        if is_personal_task(self.title):
            self.priority = "medium"
            self.priority_before_time = "medium" if self.time_prefix_in_title else None
            if self.sheet_emphasis is not None:
                self.sheet_emphasis = False
            if kwargs.get("update_fields"):
                kwargs["update_fields"] = set(kwargs["update_fields"]) | {
                    "priority", "priority_before_time", "sheet_emphasis"
                }
        return super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.work_date} · {self.title}"


class WorkScheduleSheetChange(models.Model):
    STATUS_PENDING = "pending"
    STATUS_PROCESSING = "processing"
    STATUS_DONE = "done"
    STATUS_FAILED = "failed"
    STATUS_CONFLICT = "conflict"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Chờ đồng bộ"),
        (STATUS_PROCESSING, "Đang đồng bộ"),
        (STATUS_DONE, "Đã đồng bộ"),
        (STATUS_FAILED, "Lỗi"),
        (STATUS_CONFLICT, "Xung đột"),
    ]

    executor_email = models.EmailField(db_index=True)
    work_date = models.DateField(db_index=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["created_at", "pk"]


class WorkScheduleSheetSyncLease(models.Model):
    key = models.CharField(max_length=40, primary_key=True, default="ft-work-schedule")
    locked_until = models.DateTimeField(blank=True, null=True)


class WorkScheduleSheetInboundEvent(models.Model):
    """One onEdit webhook call from the Apps Script trigger (Sheet -> Web direction)."""

    STATUS_PROCESSING = "processing"
    STATUS_PROCESSED = "processed"
    STATUS_SKIPPED = "skipped"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [
        (STATUS_PROCESSING, "Đang xử lý"),
        (STATUS_PROCESSED, "Đã xử lý"),
        (STATUS_SKIPPED, "Bỏ qua do đang đồng bộ"),
        (STATUS_FAILED, "Lỗi"),
    ]

    event_id = models.CharField(max_length=64, unique=True, db_index=True)
    row_number = models.PositiveIntegerField()
    payload = models.JSONField()
    edited_at = models.DateTimeField(blank=True, null=True, db_index=True)
    editor_email = models.EmailField(blank=True, default="")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, db_index=True)
    created_count = models.PositiveSmallIntegerField(default=0)
    updated_count = models.PositiveSmallIntegerField(default=0)
    error = models.TextField(blank=True, default="")
    received_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["-received_at"]
