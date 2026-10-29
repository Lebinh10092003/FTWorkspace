from django.db import models
from django.utils import timezone
from authentication.models import UserProfile


class NewsPost(models.Model):
    """Bản tin bài: lưu thông tin các buổi, khảo sát, kết quả bài viết và trạng thái."""

    TYPE_FB_TRAINING = "fb_training"
    TYPE_FB_MEETING = "fb_meeting"
    TYPE_PRESS_ARTICLE = "press_article"

    TYPE_CHOICES = [
        (TYPE_FB_TRAINING, "Facebook - Tập huấn"),
        (TYPE_FB_MEETING, "Facebook - Họp / Làm việc / Đối tác"),
        (TYPE_PRESS_ARTICLE, "Bài báo (Báo chí)"),
    ]

    STATUS_DRAFT = "draft"
    STATUS_GENERATING = "generating"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"

    STATUS_CHOICES = [
        (STATUS_DRAFT, "Bản nháp"),
        (STATUS_GENERATING, "Đang tạo AI"),
        (STATUS_COMPLETED, "Hoàn thành"),
        (STATUS_FAILED, "Thất bại"),
    ]

    owner = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="news_posts")
    post_type = models.CharField(max_length=50, choices=TYPE_CHOICES, default=TYPE_FB_TRAINING, db_index=True)
    title = models.CharField(max_length=255, blank=True, default="")

    # Thông tin các buổi làm việc: unit_name, sessions (list), notes...
    input_payload = models.JSONField(default=dict, blank=True)

    # Tổng hợp kết quả khảo sát (tính bằng mã, không qua AI): total_responses, total_ratings, categories...
    survey_summary = models.JSONField(default=dict, blank=True)

    # Kết quả bài viết hoàn chỉnh: headline, lead_in, sections, survey_section, closing, slogan, contact_info, hashtags, raw_text
    content_payload = models.JSONField(default=dict, blank=True)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["owner", "status"], name="news_post_owner_status"),
            models.Index(fields=["owner", "-created_at"], name="news_post_owner_created"),
        ]

    def __str__(self):
        return f"NewsPost #{self.pk} · {self.owner.email} · {self.title or self.get_post_type_display()}"


class NewsPostJob(models.Model):
    """Job xử lý hàng đợi AI sinh tin bài."""

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

    news_post = models.ForeignKey(NewsPost, on_delete=models.CASCADE, related_name="ai_jobs")
    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="news_post_jobs")
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
            models.Index(fields=["status", "created_at"], name="np_job_status_created"),
            models.Index(fields=["user", "status"], name="np_job_user_status"),
        ]

    def __str__(self):
        return f"NewsPostJob #{self.pk} · {self.user.email} · {self.status}"
