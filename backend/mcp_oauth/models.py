"""OAuth 2.1 cho MCP: ChatGPT/Claude mở trang đăng nhập web, người dùng đăng nhập là kết nối xong.

Mã bí mật (client secret, mã ủy quyền, access/refresh token) chỉ lưu dạng SHA-256.
"""
from django.conf import settings
from django.db import models


class OAuthClient(models.Model):
    """Ứng dụng AI đã tự đăng ký (RFC 7591) hoặc client_id là URL tài liệu metadata."""

    client_id = models.CharField(max_length=512, unique=True)
    client_secret_hash = models.CharField(max_length=64, blank=True)
    name = models.CharField(max_length=200, blank=True)
    redirect_uris = models.JSONField(default=list)
    token_endpoint_auth_method = models.CharField(max_length=40, default="none")
    is_metadata_document = models.BooleanField(default=False)
    metadata_fetched_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name or self.client_id


class OAuthAuthorizationCode(models.Model):
    code_hash = models.CharField(max_length=64, unique=True)
    client = models.ForeignKey(OAuthClient, on_delete=models.CASCADE, related_name="codes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="mcp_oauth_codes")
    redirect_uri = models.TextField()
    code_challenge = models.CharField(max_length=128)
    scope = models.CharField(max_length=200, blank=True)
    resource = models.CharField(max_length=500, blank=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)


class OAuthGrant(models.Model):
    """Một kết nối AI của một người. Làm mới token thì thay mã trong cùng dòng này."""

    client = models.ForeignKey(OAuthClient, on_delete=models.CASCADE, related_name="grants")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="mcp_oauth_grants")
    access_hash = models.CharField(max_length=64, unique=True)
    refresh_hash = models.CharField(max_length=64, unique=True)
    access_expires_at = models.DateTimeField()
    refresh_expires_at = models.DateTimeField()
    scope = models.CharField(max_length=200, blank=True)
    resource = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
