from django.db import models

class FbBotProfile(models.Model):
    code = models.CharField(max_length=64, primary_key=True)
    name = models.CharField(max_length=255)
    role = models.CharField(max_length=255)
    email = models.CharField(max_length=255, unique=True)
    avatar_config = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.code})"

class FbMaterialUpload(models.Model):
    title = models.CharField(max_length=255)
    content = models.TextField(blank=True)
    file_url = models.CharField(max_length=1000, blank=True)
    image_urls = models.JSONField(default=list, blank=True)
    author = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title

class FbDraftPost(models.Model):
    STATUS_CHOICES = [
        ('draft', 'Nháp'),
        ('pending', 'Chờ duyệt'),
        ('approved', 'Đã duyệt'),
        ('published', 'Đã đăng'),
        ('rejected', 'Từ chối'),
    ]
    title = models.CharField(max_length=255)
    content = models.TextField()
    hashtags = models.CharField(max_length=500, blank=True)
    image_urls = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default='draft')
    bot_creator = models.CharField(max_length=64, default='writer')
    created_at = models.DateTimeField(auto_now_add=True)
    published_at = models.DateTimeField(null=True, blank=True)
    fb_post_url = models.CharField(max_length=1000, blank=True)

    def __str__(self):
        return f"[{self.get_status_display()}] {self.title}"

class FbPublishTarget(models.Model):
    TARGET_TYPE_CHOICES = [
        ('page', 'Fanpage'),
        ('group', 'Facebook Group'),
    ]
    name = models.CharField(max_length=255)
    target_type = models.CharField(max_length=32, choices=TARGET_TYPE_CHOICES, default='page')
    target_id = models.CharField(max_length=255)
    access_token = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.get_target_type_display()})"
