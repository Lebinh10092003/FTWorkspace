from datetime import time
from django.db import models
from authentication.models import UserProfile


class ZaloLink(models.Model):
    """
    Liên kết 1-1 giữa tài khoản Workspace và tài khoản Zalo.
    QUY TẮC: Mỗi user chỉ gắn với đúng 1 chat_id và ngược lại.
    """

    DETAIL_TITLE = "title"
    DETAIL_SUMMARY = "summary"
    DETAIL_CHOICES = [
        (DETAIL_TITLE, "Chỉ tiêu đề + link mở workspace"),
        (DETAIL_SUMMARY, "Kèm tóm tắt nội dung ngắn"),
    ]

    user = models.OneToOneField(
        UserProfile,
        on_delete=models.CASCADE,
        related_name="zalo_link",
        verbose_name="Người dùng Workspace",
    )
    chat_id = models.CharField(
        max_length=128,
        unique=True,
        db_index=True,
        verbose_name="Chat ID Zalo",
    )
    zalo_user_id = models.CharField(
        max_length=128,
        blank=True,
        default="",
        verbose_name="Zalo User ID",
    )
    linked_at = models.DateTimeField(auto_now_add=True)

    is_enabled = models.BooleanField(
        default=True,
        verbose_name="Bật thông báo qua Zalo",
    )
    detail_level = models.CharField(
        max_length=20,
        default=DETAIL_TITLE,
        choices=DETAIL_CHOICES,
        verbose_name="Mức chi tiết thông báo",
    )
    notify_schedule = models.BooleanField(
        default=True,
        verbose_name="Thông báo lịch công tác",
    )
    notify_gmail = models.BooleanField(
        default=True,
        verbose_name="Thông báo Gmail mới / bản tin sáng",
    )
    notify_weekly_report = models.BooleanField(
        default=True,
        verbose_name="Thông báo báo cáo tuần",
    )
    notify_workspace = models.BooleanField(
        default=True,
        verbose_name="Thông báo chung workspace",
    )

    quiet_hours_enabled = models.BooleanField(
        default=True,
        verbose_name="Bật khung giờ yên lặng",
    )
    quiet_hours_start = models.TimeField(
        default=time(22, 0),
        verbose_name="Giờ bắt đầu yên lặng",
    )
    quiet_hours_end = models.TimeField(
        default=time(7, 0),
        verbose_name="Giờ kết thúc yên lặng",
    )

    daily_cap = models.PositiveIntegerField(
        default=50,
        verbose_name="Số tin tối đa nhận mỗi ngày",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "zalo_links"
        verbose_name = "Liên kết Zalo"
        verbose_name_plural = "Liên kết Zalo"

    def __str__(self):
        return f"{self.user.email} -> Zalo Chat: {self.chat_id} ({'Bật' if self.is_enabled else 'Tắt'})"


class ZaloLinkCode(models.Model):
    """
    Mã liên kết 6 ký tự số dùng một lần, hết hạn 10 phút.
    Lưu dạng băm SHA-256 để bảo vệ an toàn.
    """

    user = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name="zalo_link_codes",
    )
    code_hash = models.CharField(max_length=64, db_index=True)
    expires_at = models.DateTimeField(db_index=True)
    is_used = models.BooleanField(default=False, db_index=True)
    failed_attempts = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "zalo_link_codes"
        verbose_name = "Mã liên kết Zalo"
        verbose_name_plural = "Mã liên kết Zalo"
        indexes = [
            models.Index(fields=["code_hash", "is_used", "expires_at"], name="zalo_code_hash_idx"),
        ]

    def __str__(self):
        return f"Mã liên kết của {self.user.email} (Đã dùng: {self.is_used})"


class ZaloPendingAction(models.Model):
    """
    Hành động chờ xác nhận từ người dùng qua Zalo (hết hạn 12h).
    Quy tắc: Thao tác ghi dữ liệu (trừ 'xong') cần trả lời 'ok'/'có' để xác nhận.
    """

    user = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name="zalo_pending_actions",
    )
    chat_id = models.CharField(max_length=128, db_index=True)
    action_type = models.CharField(max_length=64, db_index=True)
    payload = models.JSONField(default=dict)
    prompt_message = models.CharField(max_length=500, blank=True, default="")
    expires_at = models.DateTimeField(db_index=True)
    is_confirmed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "zalo_pending_actions"
        verbose_name = "Hành động chờ xác nhận Zalo"
        verbose_name_plural = "Hành động chờ xác nhận Zalo"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.email} - {self.action_type} (Chờ xác nhận)"


class ZaloSendLog(models.Model):
    """
    Nhật ký gửi tin Zalo.
    TUYỆT ĐỐI KHÔNG LƯU NỘI DUNG TIN NHẮN để bảo mật dữ liệu.
    """

    STATUS_SENT = "sent"
    STATUS_FAILED = "failed"
    STATUS_SKIPPED = "skipped"

    user = models.ForeignKey(
        UserProfile,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="zalo_send_logs",
    )
    chat_id = models.CharField(max_length=128, blank=True, default="")
    category = models.CharField(max_length=64, db_index=True)
    sent_at = models.DateTimeField(auto_now_add=True, db_index=True)
    status = models.CharField(
        max_length=20,
        default=STATUS_SENT,
        choices=[
            (STATUS_SENT, "Thành công"),
            (STATUS_FAILED, "Thất bại"),
            (STATUS_SKIPPED, "Bỏ qua"),
        ],
    )
    error_message = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        db_table = "zalo_send_logs"
        verbose_name = "Nhật ký gửi Zalo"
        verbose_name_plural = "Nhật ký gửi Zalo"
        ordering = ["-sent_at"]

    def __str__(self):
        return f"[{self.category}] {self.status} at {self.sent_at}"


class ZaloInboundEvent(models.Model):
    """
    Theo dõi message_id từ webhook để đảm bảo xử lý idempotent, tránh xử lý trùng.
    """

    message_id = models.CharField(max_length=128, unique=True, db_index=True)
    chat_id = models.CharField(max_length=128, db_index=True)
    received_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "zalo_inbound_events"
        verbose_name = "Sự kiện Webhook Zalo đến"
        verbose_name_plural = "Sự kiện Webhook Zalo đến"

    def __str__(self):
        return f"Inbound {self.message_id} from {self.chat_id}"


class ZaloReminderHistory(models.Model):
    """
    Lịch sử nhắc việc để đảm bảo mỗi công việc chỉ nhắc tối đa 1 lần / ngày.
    """

    user = models.ForeignKey(
        UserProfile,
        on_delete=models.CASCADE,
        related_name="zalo_reminder_histories",
    )
    work_item_id = models.PositiveIntegerField(db_index=True)
    reminder_date = models.DateField(db_index=True)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "zalo_reminder_histories"
        verbose_name = "Lịch sử nhắc việc Zalo"
        verbose_name_plural = "Lịch sử nhắc việc Zalo"
        unique_together = ("user", "work_item_id", "reminder_date")

    def __str__(self):
        return f"{self.user.email} - Item {self.work_item_id} on {self.reminder_date}"
