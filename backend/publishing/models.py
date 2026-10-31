"""Database models for the Publishing module (Đăng bài truyền thông đa kênh).

Includes:
- PublishChannel: Kênh xuất bản (Fanpage, Webhook, WordPress, Nhóm FB, Nhóm Zalo...)
- PostPlan: Kế hoạch bài đăng (Nội dung gốc, trạng thái duyệt, lịch đăng chung)
- PostVariant: Biến thể bài viết theo từng kênh (Nội dung riêng, giờ đăng riêng, kết quả)
- PublishAiJob: Hàng đợi AI sinh biến thể bài đăng theo từng kênh
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from django.db import models
from django.utils import timezone

from authentication.models import UserProfile
from news_posts.models import NewsPost
from .security import decrypt_config, encrypt_config, mask_config_for_display


class PublishChannel(models.Model):
    """Kênh đăng bài truyền thông do người dùng tự khai báo hoặc quản trị viên chia sẻ."""

    KIND_WEB_WEBHOOK = "web_webhook"
    KIND_WEB_WORDPRESS = "web_wordpress"
    KIND_FACEBOOK_PAGE = "facebook_page"
    KIND_MANUAL_FB_GROUP = "manual_facebook_group"
    KIND_MANUAL_ZALO_GROUP = "manual_zalo_group"
    KIND_MANUAL_OTHER = "manual_other"
    KIND_ZALO_OA = "zalo_oa"

    KIND_CHOICES = [
        (KIND_WEB_WEBHOOK, "Web (Webhook JSON)"),
        (KIND_WEB_WORDPRESS, "WordPress REST API"),
        (KIND_FACEBOOK_PAGE, "Fanpage Facebook (API chính thức)"),
        (KIND_MANUAL_FB_GROUP, "Nhóm Facebook (Nhắc thủ công)"),
        (KIND_MANUAL_ZALO_GROUP, "Nhóm Zalo cá nhân (Nhắc thủ công)"),
        (KIND_MANUAL_OTHER, "Kênh thủ công khác"),
        (KIND_ZALO_OA, "Zalo Official Account (Adapter mở rộng)"),
    ]

    owner = models.ForeignKey(
        UserProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="publish_channels",
        help_text="Người tạo kênh; nếu là kênh dùng chung thì có thể dùng bởi toàn bộ nhân viên.",
    )
    is_shared = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Kênh dùng chung toàn hệ thống do Quản trị viên/Quản lý tạo.",
    )
    name = models.CharField(max_length=255)
    kind = models.CharField(max_length=50, choices=KIND_CHOICES, db_index=True)
    encrypted_config = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_shared", "name", "-created_at"]
        indexes = [
            models.Index(fields=["kind", "is_active"], name="pub_chan_kind_active"),
            models.Index(fields=["owner", "is_active"], name="pub_chan_owner_active"),
        ]

    def __str__(self) -> str:
        prefix = "[Chung] " if self.is_shared else ""
        return f"{prefix}{self.name} ({self.get_kind_display()})"

    def get_config(self) -> Dict[str, Any]:
        """Giải mã cấu hình bảo mật từ cơ sở dữ liệu."""
        return decrypt_config(self.encrypted_config)

    def set_config(self, config: Dict[str, Any]) -> None:
        """Mã hóa cấu hình an toàn bằng Fernet trước khi lưu."""
        self.encrypted_config = encrypt_config(config)

    def get_masked_config(self) -> Dict[str, Any]:
        """Trả về cấu hình đã che dấu token/mật khẩu an toàn cho API."""
        raw_cfg = self.get_config()
        return mask_config_for_display(raw_cfg, self.kind)


class PostPlan(models.Model):
    """Kế hoạch bài đăng truyền thông tổng thể, quản lý vòng đời duyệt và phát hành."""

    STATUS_DRAFT = "draft"
    STATUS_PENDING_APPROVAL = "pending_approval"
    STATUS_APPROVED = "approved"
    STATUS_SCHEDULED = "scheduled"
    STATUS_PUBLISHED = "published"
    STATUS_PARTIAL = "partial"
    STATUS_FAILED = "failed"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_DRAFT, "Bản nháp"),
        (STATUS_PENDING_APPROVAL, "Chờ duyệt"),
        (STATUS_APPROVED, "Đã duyệt"),
        (STATUS_SCHEDULED, "Đã lên lịch"),
        (STATUS_PUBLISHED, "Đã đăng"),
        (STATUS_PARTIAL, "Đăng một phần"),
        (STATUS_FAILED, "Thất bại"),
        (STATUS_CANCELLED, "Đã hủy"),
    ]

    title = models.CharField(max_length=255)
    base_content = models.TextField(
        blank=True,
        default="",
        help_text="Nội dung gốc hoặc ý chính ban đầu.",
    )
    news_post = models.ForeignKey(
        NewsPost,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="post_plans",
        help_text="Liên kết tùy chọn tới bài viết đã soạn thảo trong NewsPost.",
    )
    creator = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name="post_plans",
    )
    approved_by = models.ForeignKey(
        UserProfile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_post_plans",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(
        max_length=30,
        choices=STATUS_CHOICES,
        default=STATUS_DRAFT,
        db_index=True,
    )
    scheduled_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Thời gian dự kiến đăng bài (giờ ICT).",
    )
    meta_notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "scheduled_at"], name="post_plan_status_sched"),
            models.Index(fields=["creator", "status"], name="post_plan_creator_status"),
        ]

    def __str__(self) -> str:
        return f"PostPlan #{self.pk} · {self.title} [{self.get_status_display()}]"

    def invalidate_approval_if_modified(self) -> bool:
        """Nếu bài đã được duyệt mà nội dung thay đổi, thu hồi phê duyệt để đảm bảo an toàn."""
        if self.status in [self.STATUS_APPROVED, self.STATUS_SCHEDULED]:
            self.status = self.STATUS_PENDING_APPROVAL
            self.approved_by = None
            self.approved_at = None
            return True
        return False


class PostVariant(models.Model):
    """Biến thể bài đăng cho một kênh cụ thể (được cá nhân hóa văn phong/độ dài)."""

    STATUS_DRAFT = "draft"
    STATUS_PENDING_APPROVAL = "pending_approval"
    STATUS_APPROVED = "approved"
    STATUS_SCHEDULED = "scheduled"
    STATUS_PUBLISHING = "publishing"
    STATUS_PUBLISHED = "published"
    STATUS_AWAITING_MANUAL = "awaiting_manual"
    STATUS_FAILED = "failed"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_DRAFT, "Bản nháp"),
        (STATUS_PENDING_APPROVAL, "Chờ duyệt"),
        (STATUS_APPROVED, "Đã duyệt"),
        (STATUS_SCHEDULED, "Đã lên lịch"),
        (STATUS_PUBLISHING, "Đang gửi"),
        (STATUS_PUBLISHED, "Đã đăng"),
        (STATUS_AWAITING_MANUAL, "Chờ đăng thủ công"),
        (STATUS_FAILED, "Thất bại"),
        (STATUS_CANCELLED, "Đã hủy"),
    ]

    plan = models.ForeignKey(
        PostPlan,
        on_delete=models.CASCADE,
        related_name="variants",
    )
    channel = models.ForeignKey(
        PublishChannel,
        on_delete=models.CASCADE,
        related_name="variants",
    )
    title = models.CharField(max_length=255, blank=True, default="")
    content = models.TextField(blank=True, default="")
    link_url = models.CharField(max_length=1000, blank=True, default="")
    scheduled_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Thời gian đăng riêng của kênh (nếu để trống sẽ dùng scheduled_at của plan).",
    )
    status = models.CharField(
        max_length=30,
        choices=STATUS_CHOICES,
        default=STATUS_DRAFT,
        db_index=True,
    )
    external_post_id = models.CharField(max_length=255, blank=True, default="")
    external_post_url = models.CharField(max_length=1000, blank=True, default="")
    error_message = models.TextField(blank=True, default="")
    retry_count = models.IntegerField(default=0)
    published_at = models.DateTimeField(null=True, blank=True)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["plan", "channel"], name="unique_plan_channel_variant")
        ]
        indexes = [
            models.Index(fields=["status", "scheduled_at"], name="variant_status_sched"),
            models.Index(fields=["channel", "status"], name="variant_channel_status"),
        ]

    def __str__(self) -> str:
        return f"Variant #{self.pk} · Plan #{self.plan_id} -> {self.channel.name} [{self.status}]"

    def effective_scheduled_at(self) -> Optional[timezone.datetime]:
        """Lấy mốc thời gian đăng bài hiệu lực (ưu tiên lịch riêng của variant, sau đó tới plan)."""
        return self.scheduled_at or self.plan.scheduled_at


class PublishAiJob(models.Model):
    """Hàng đợi xử lý tác vụ AI tạo biến thể bài đăng theo từng kênh."""

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

    plan = models.ForeignKey(PostPlan, on_delete=models.CASCADE, related_name="ai_jobs")
    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name="publish_ai_jobs")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_QUEUED, db_index=True)
    channel_ids = models.JSONField(default=list, blank=True)
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
            models.Index(fields=["status", "created_at"], name="pub_job_status_created"),
            models.Index(fields=["user", "status"], name="pub_job_user_status"),
        ]

    def __str__(self) -> str:
        return f"PublishAiJob #{self.pk} · Plan #{self.plan_id} · {self.status}"
