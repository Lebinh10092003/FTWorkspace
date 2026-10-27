from django.db import models


class CompanyAccount(models.Model):
    """Một tài khoản dịch vụ do công ty sở hữu (email, AI, thiết kế, tên miền, cổng thuế...).

    Mật khẩu chỉ lưu dạng mã hóa (`password_encrypted`); API không bao giờ trả về trong danh sách.
    """

    CATEGORY_CHOICES = [
        ("email", "Email & Văn phòng"),
        ("ai", "Công cụ AI"),
        ("design", "Thiết kế & Media"),
        ("social", "Mạng xã hội"),
        ("cloud", "Cloud & Lưu trữ"),
        ("domain", "Tên miền & Hosting"),
        ("software", "Phần mềm & Bản quyền"),
        ("finance", "Ngân hàng & Thanh toán"),
        ("government", "Dịch vụ công (Thuế, BHXH...)"),
        ("other", "Khác"),
    ]
    STATUS_CHOICES = [
        ("active", "Đang dùng"),
        ("suspended", "Tạm ngưng"),
        ("cancelled", "Đã hủy"),
    ]
    BILLING_CHOICES = [
        ("free", "Miễn phí"),
        ("monthly", "Hàng tháng"),
        ("quarterly", "Hàng quý"),
        ("yearly", "Hàng năm"),
        ("one_time", "Một lần"),
    ]

    name = models.CharField(max_length=255)
    category = models.CharField(max_length=30, choices=CATEGORY_CHOICES, default="other")
    provider = models.CharField(max_length=255, blank=True, default="")
    login_url = models.CharField(max_length=1000, blank=True, default="")
    username = models.CharField(max_length=255, blank=True, default="")
    password_encrypted = models.TextField(blank=True, default="")
    password_changed_at = models.DateTimeField(null=True, blank=True)
    two_factor = models.CharField(
        max_length=255, blank=True, default="",
        help_text="Nơi nhận mã 2FA (số điện thoại, thiết bị, app). Không lưu mã khôi phục ở đây.",
    )
    recovery_email = models.CharField(max_length=255, blank=True, default="")
    recovery_phone = models.CharField(max_length=50, blank=True, default="")

    owner_email = models.EmailField(blank=True, default="")
    department = models.CharField(max_length=120, blank=True, default="")
    users = models.JSONField(default=list, blank=True)

    plan = models.CharField(max_length=255, blank=True, default="")
    cost = models.DecimalField(max_digits=15, decimal_places=0, null=True, blank=True)
    currency = models.CharField(max_length=10, default="VND")
    billing_cycle = models.CharField(max_length=20, choices=BILLING_CHOICES, default="free")
    renewal_date = models.DateField(null=True, blank=True)
    auto_renew = models.BooleanField(default=False)
    payment_method = models.CharField(max_length=255, blank=True, default="")

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    tags = models.JSONField(default=list, blank=True)
    notes = models.TextField(blank=True, default="")

    created_by = models.EmailField(blank=True, default="")
    updated_by = models.EmailField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category", "name"]
        indexes = [models.Index(fields=["status", "renewal_date"])]

    def __str__(self):
        return f"{self.name} ({self.username})" if self.username else self.name


class CompanyAccountLog(models.Model):
    """Nhật ký ai đã tạo, sửa, xóa hoặc xem mật khẩu của tài khoản công ty."""

    ACTION_CHOICES = [
        ("create", "Tạo"),
        ("update", "Cập nhật"),
        ("password", "Đổi mật khẩu"),
        ("reveal", "Xem mật khẩu"),
        ("delete", "Xóa"),
    ]

    account = models.ForeignKey(CompanyAccount, null=True, blank=True, on_delete=models.SET_NULL, related_name="logs")
    account_name = models.CharField(max_length=255, blank=True, default="")
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    actor_email = models.CharField(max_length=255, blank=True, default="")
    channel = models.CharField(max_length=20, default="web")  # web | mcp
    detail = models.CharField(max_length=500, blank=True, default="")
    ip = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
