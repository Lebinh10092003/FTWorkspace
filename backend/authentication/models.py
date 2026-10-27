from django.db import models


class Department(models.Model):
    name = models.CharField(max_length=120, unique=True)
    code = models.CharField(max_length=30, blank=True, default='')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class JobTitle(models.Model):
    name = models.CharField(max_length=120, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class UserProfile(models.Model):
    email = models.EmailField(primary_key=True)
    name = models.CharField(max_length=255, blank=True, null=True)
    role = models.CharField(max_length=50, default='EMPLOYEE')
    photo_url = models.CharField(max_length=1000, blank=True, null=True)
    employee_code = models.CharField(max_length=50, blank=True, null=True, unique=True)
    phone = models.CharField(max_length=30, blank=True, default='')
    department = models.ForeignKey(Department, blank=True, null=True, on_delete=models.SET_NULL, related_name='employees')
    departments = models.ManyToManyField(Department, blank=True, related_name='member_employees')
    job_title = models.ForeignKey(JobTitle, blank=True, null=True, on_delete=models.SET_NULL, related_name='employees')
    manager = models.ForeignKey('self', blank=True, null=True, on_delete=models.SET_NULL, related_name='direct_reports')
    start_date = models.DateField(blank=True, null=True)
    employment_status = models.CharField(max_length=30, default='ACTIVE')
    access_modules = models.JSONField(default=list, blank=True)
    last_login = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.email} ({self.role})'


class WorkspaceNotification(models.Model):
    """One idempotent Workspace event, filtered to its intended audience."""

    SEVERITY_CHOICES = [
        ('info', 'Thông tin'),
        ('warning', 'Cảnh báo'),
        ('urgent', 'Khẩn'),
        ('success', 'Thành công'),
    ]
    event_key = models.CharField(max_length=255, unique=True)
    title = models.CharField(max_length=255)
    message = models.TextField()
    category = models.CharField(max_length=80, default='workspace')
    severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES, default='info')
    action_url = models.CharField(max_length=1000, blank=True, default='')
    target_roles = models.JSONField(default=list, blank=True)
    target_modules = models.JSONField(default=list, blank=True)
    target_emails = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']


class WorkspaceNotificationRead(models.Model):
    notification = models.ForeignKey(WorkspaceNotification, on_delete=models.CASCADE, related_name='read_receipts')
    user = models.ForeignKey(UserProfile, on_delete=models.CASCADE, related_name='notification_reads')
    read_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['notification', 'user'], name='unique_workspace_notification_read'),
        ]


class UserLogin(models.Model):
    id = models.CharField(max_length=255, primary_key=True)
    email = models.CharField(max_length=255)
    name = models.CharField(max_length=255, blank=True, null=True)
    role = models.CharField(max_length=50)
    login_at = models.DateTimeField()
    user_agent = models.TextField(blank=True, null=True)
    ip = models.CharField(max_length=50, blank=True, null=True)

    def __str__(self):
        return f'{self.email} at {self.login_at}'


class SystemConfig(models.Model):
    key = models.CharField(max_length=255, primary_key=True)
    admin_emails = models.TextField(blank=True, null=True)
    last_google_access_token = models.TextField(blank=True, null=True)
    last_google_access_token_time = models.DateTimeField(null=True, blank=True)
    data = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return self.key


class LoginThrottle(models.Model):
    """Đếm lần đăng nhập sai theo email hoặc IP để chặn dò mật khẩu."""

    key = models.CharField(max_length=320, unique=True)
    failures = models.PositiveIntegerField(default=0)
    window_started_at = models.DateTimeField()
    locked_until = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
