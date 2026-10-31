"""Channel adapters and dispatchers for the Publishing module.

Supports:
- Facebook Page (Official Meta Graph API, scheduled_publish_time + published=false)
- Web Webhook (POST JSON to configurable endpoint with secret signature)
- WordPress (WP REST API with Application Password)
- Manual Channels (Facebook Group, Zalo Group, etc. - in-app reminder via notify_workspace)
- Zalo OA (adapter stub)
- Mock mode (PUBLISH_MOCK_MODE=1) for local dev and deterministic E2E testing
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
from typing import Any, Dict, Optional, Tuple

import requests
from django.utils import timezone

from authentication.notifications import notify_workspace
from .models import PostPlan, PostVariant, PublishChannel

logger = logging.getLogger(__name__)

META_GRAPH_VERSION = "v21.0"
FACEBOOK_RATE_LIMIT_ERROR_CODES = {4, 17, 32, 613, 80001}


def is_mock_mode() -> bool:
    """Return True if mock mode is explicitly activated (DEV ONLY)."""
    val = os.getenv("PUBLISH_MOCK_MODE", "").strip().lower()
    return val in {"1", "true", "yes"}


class PublishAdapterError(Exception):
    """Base exception for publishing errors."""

    def __init__(self, message: str, retryable: bool = False, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.retryable = retryable
        self.details = details or {}


def test_channel_connection(channel: PublishChannel) -> Dict[str, Any]:
    """Test channel connectivity and credential validity without posting."""
    cfg = channel.get_config()
    mock = is_mock_mode()

    if channel.kind == PublishChannel.KIND_FACEBOOK_PAGE:
        page_id = str(cfg.get("page_id") or cfg.get("pageId") or "").strip()
        token = str(cfg.get("access_token") or cfg.get("accessToken") or "").strip()
        if not page_id or not token:
            return {
                "success": False,
                "message": "Thiếu Page ID hoặc Access Token của Fanpage Facebook.",
            }
        if mock:
            return {
                "success": True,
                "message": f"[Mock Mode] Kết nối Fanpage {page_id} thành công.",
                "details": {"page_id": page_id, "name": f"Mock Page {page_id}"},
            }
        try:
            # Check debug_token or page metadata
            res = requests.get(
                f"https://graph.facebook.com/{META_GRAPH_VERSION}/debug_token",
                params={"input_token": token, "access_token": token},
                timeout=10,
            )
            data = res.json()
            if res.status_code != 200 or not data.get("data", {}).get("is_valid"):
                err = (data.get("error") or data.get("data", {}).get("error") or {}).get("message", "Token không hợp lệ.")
                return {
                    "success": False,
                    "message": f"Token Facebook không hợp lệ hoặc đã hết hạn: {err}",
                }
            # Verify page ownership / tasks
            p_res = requests.get(
                f"https://graph.facebook.com/{META_GRAPH_VERSION}/{page_id}",
                params={"fields": "id,name,tasks", "access_token": token},
                timeout=10,
            )
            p_data = p_res.json()
            if p_res.status_code != 200 or "error" in p_data:
                err = p_data.get("error", {}).get("message", "Không tìm thấy Page.")
                return {"success": False, "message": f"Không thể đọc thông tin Page ID {page_id}: {err}"}

            return {
                "success": True,
                "message": f"Kết nối Fanpage '{p_data.get('name')}' (ID: {page_id}) thành công.",
                "details": p_data,
            }
        except Exception as exc:
            return {"success": False, "message": f"Lỗi kết nối Facebook Graph API: {exc}"}

    elif channel.kind == PublishChannel.KIND_WEB_WEBHOOK:
        url = str(cfg.get("url") or "").strip()
        if not url or not (url.startswith("http://") or url.startswith("https://")):
            return {"success": False, "message": "URL Webhook không hợp lệ (phải bắt đầu bằng http:// hoặc https://)."}
        return {
            "success": True,
            "message": "Cấu hình Webhook hợp lệ và sẵn sàng nhận payload đăng bài.",
        }

    elif channel.kind == PublishChannel.KIND_WEB_WORDPRESS:
        site_url = str(cfg.get("site_url") or cfg.get("siteUrl") or "").strip().rstrip("/")
        username = str(cfg.get("username") or "").strip()
        app_password = str(cfg.get("app_password") or cfg.get("appPassword") or "").strip()
        if not site_url or not username or not app_password:
            return {
                "success": False,
                "message": "Vui lòng nhập đủ Địa chỉ website, Tên đăng nhập và Mật khẩu ứng dụng (Application Password).",
            }
        if mock:
            return {
                "success": True,
                "message": f"[Mock Mode] Kết nối WordPress REST API tại {site_url} thành công.",
            }
        try:
            res = requests.get(
                f"{site_url}/wp-json/wp/v2/users/me",
                auth=(username, app_password),
                timeout=10,
            )
            if res.status_code in {200, 201}:
                u_data = res.json()
                return {
                    "success": True,
                    "message": f"Kết nối WordPress thành công với tài khoản '{u_data.get('name', username)}'.",
                }
            return {
                "success": False,
                "message": f"WordPress từ chối xác thực (HTTP {res.status_code}): Vui lòng kiểm tra lại Application Password.",
            }
        except Exception as exc:
            return {"success": False, "message": f"Không thể kết nối đến máy chủ WordPress: {exc}"}

    elif channel.kind in {
        PublishChannel.KIND_MANUAL_FB_GROUP,
        PublishChannel.KIND_MANUAL_ZALO_GROUP,
        PublishChannel.KIND_MANUAL_OTHER,
    }:
        url = str(cfg.get("group_url") or cfg.get("groupUrl") or cfg.get("url") or "").strip()
        return {
            "success": True,
            "message": "Kênh thủ công đã được lưu. Khi đến giờ đăng, hệ thống sẽ gửi thông báo trong ứng dụng kèm nội dung đã soạn sẵn.",
            "details": {"group_url": url},
        }

    elif channel.kind == PublishChannel.KIND_ZALO_OA:
        return {
            "success": False,
            "message": "Zalo Official Account đang ở chế độ adapter mở rộng, vui lòng liên hệ quản trị khi có tài khoản OA.",
        }

    return {"success": False, "message": "Loại kênh chưa được hỗ trợ kiểm tra kết nối."}


def dispatch_variant(variant: PostVariant) -> Dict[str, Any]:
    """Dispatch a single post variant to its destination channel."""
    plan = variant.plan
    channel = variant.channel

    # 1. Safety verification: Must be approved
    if plan.status not in [PostPlan.STATUS_APPROVED, PostPlan.STATUS_SCHEDULED]:
        raise PublishAdapterError(
            f"Bài đăng #{plan.id} chưa được duyệt (trạng thái: {plan.get_status_display()}). Tuyệt đối không thể xuất bản.",
            retryable=False,
        )

    # 2. Channel active check
    if not channel.is_active:
        raise PublishAdapterError(
            f"Kênh '{channel.name}' đang bị tạm tắt trong cài đặt.",
            retryable=False,
        )

    cfg = channel.get_config()
    mock = is_mock_mode()
    content = variant.content.strip() if variant.content else plan.base_content.strip()
    title = variant.title.strip() if variant.title else plan.title.strip()
    link_url = variant.link_url.strip()

    # 3. Channel-specific dispatching
    if channel.kind == PublishChannel.KIND_FACEBOOK_PAGE:
        return _dispatch_facebook_page(variant, cfg, content, link_url, mock)

    elif channel.kind == PublishChannel.KIND_WEB_WEBHOOK:
        return _dispatch_web_webhook(variant, cfg, title, content, link_url, mock)

    elif channel.kind == PublishChannel.KIND_WEB_WORDPRESS:
        return _dispatch_wordpress(variant, cfg, title, content, link_url, mock)

    elif channel.kind in {
        PublishChannel.KIND_MANUAL_FB_GROUP,
        PublishChannel.KIND_MANUAL_ZALO_GROUP,
        PublishChannel.KIND_MANUAL_OTHER,
    }:
        return _dispatch_manual_channel(variant, cfg, title, content, link_url, mock)

    elif channel.kind == PublishChannel.KIND_ZALO_OA:
        raise PublishAdapterError("Kênh Zalo OA hiện chưa có tài khoản chính thức để kết nối.", retryable=False)

    raise PublishAdapterError(f"Chưa hỗ trợ xuất bản tới kênh loại: {channel.kind}", retryable=False)


def _dispatch_facebook_page(
    variant: PostVariant,
    cfg: Dict[str, Any],
    content: str,
    link_url: str,
    mock: bool,
) -> Dict[str, Any]:
    page_id = str(cfg.get("page_id") or cfg.get("pageId") or "").strip()
    token = str(cfg.get("access_token") or cfg.get("accessToken") or "").strip()

    if not page_id or not token:
        raise PublishAdapterError(
            "Kênh Facebook Fanpage thiếu Page ID hoặc Access Token hợp lệ.",
            retryable=False,
        )

    if mock:
        mock_id = f"mock_fb_{page_id}_{variant.id}"
        mock_url = f"https://facebook.com/{page_id}/posts/{variant.id}"
        return {
            "external_post_id": mock_id,
            "external_post_url": mock_url,
            "status": PostVariant.STATUS_PUBLISHED,
            "message": "[Mock Mode] Đã xuất bản lên Fanpage Facebook giả lập.",
        }

    # Meta Graph API endpoint: POST /{page-id}/feed
    url = f"https://graph.facebook.com/{META_GRAPH_VERSION}/{page_id}/feed"
    payload: Dict[str, Any] = {
        "message": content,
        "access_token": token,
    }
    if link_url:
        payload["link"] = link_url

    # Check scheduling
    eff_sched = variant.effective_scheduled_at()
    now = timezone.now()
    if eff_sched and eff_sched > now + timezone.timedelta(minutes=10):
        # Meta allows scheduled publish time from 10 minutes up to 75 days in the future
        payload["published"] = "false"
        payload["scheduled_publish_time"] = int(eff_sched.timestamp())
    else:
        payload["published"] = "true"

    try:
        res = requests.post(url, data=payload, timeout=20)
        data = res.json()
        if res.status_code == 200 and "id" in data:
            post_id = data["id"]
            # Page post IDs are usually pageId_postId
            post_url = f"https://facebook.com/{post_id}"
            return {
                "external_post_id": post_id,
                "external_post_url": post_url,
                "status": PostVariant.STATUS_PUBLISHED,
                "message": "Đã xuất bản thành công lên Fanpage Facebook.",
            }

        # Handle errors
        error_info = data.get("error") or {}
        code = error_info.get("code")
        err_msg = error_info.get("message") or str(data)

        retryable = code in FACEBOOK_RATE_LIMIT_ERROR_CODES
        if code in {190, 102}:
            raise PublishAdapterError("Token Facebook đã hết hạn. Vui lòng cấp lại token trong Kênh đăng.", retryable=False)

        raise PublishAdapterError(f"Facebook Graph API từ chối ({code}): {err_msg}", retryable=retryable)

    except requests.RequestException as exc:
        raise PublishAdapterError(f"Lỗi mạng khi kết nối Facebook Graph API: {exc}", retryable=True)


def _dispatch_web_webhook(
    variant: PostVariant,
    cfg: Dict[str, Any],
    title: str,
    content: str,
    link_url: str,
    mock: bool,
) -> Dict[str, Any]:
    url = str(cfg.get("url") or "").strip()
    secret = str(cfg.get("secret") or "").strip()

    if not url:
        raise PublishAdapterError("Kênh Web Webhook chưa cấu hình URL nhận bài.", retryable=False)

    payload = {
        "event": "publishing.post.publish",
        "plan_id": variant.plan_id,
        "variant_id": variant.id,
        "title": title,
        "content": content,
        "link_url": link_url,
        "channel_id": variant.channel_id,
        "channel_name": variant.channel.name,
        "published_at": timezone.now().isoformat(),
    }

    if mock:
        return {
            "external_post_id": f"mock_wh_{variant.id}",
            "external_post_url": url,
            "status": PostVariant.STATUS_PUBLISHED,
            "message": "[Mock Mode] Webhook payload giả lập gửi thành công.",
        }

    raw_body = json.dumps(payload, ensure_ascii=False)
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "FT-Workspace-Publisher/1.0",
    }
    if secret:
        sig = hmac.new(secret.encode("utf-8"), raw_body.encode("utf-8"), hashlib.sha256).hexdigest()
        headers["X-Webhook-Secret"] = secret
        headers["X-Signature-SHA256"] = sig

    try:
        res = requests.post(url, data=raw_body.encode("utf-8"), headers=headers, timeout=15)
        if res.status_code in {200, 201, 202, 204}:
            ext_id = f"wh_{variant.id}_{res.status_code}"
            try:
                res_json = res.json()
                ext_id = str(res_json.get("id") or res_json.get("post_id") or ext_id)
            except Exception:
                pass
            return {
                "external_post_id": ext_id,
                "external_post_url": url,
                "status": PostVariant.STATUS_PUBLISHED,
                "message": f"Đã gửi bài qua Webhook thành công (HTTP {res.status_code}).",
            }
        raise PublishAdapterError(
            f"Webhook trả về mã lỗi HTTP {res.status_code}: {res.text[:200]}",
            retryable=res.status_code >= 500,
        )
    except requests.RequestException as exc:
        raise PublishAdapterError(f"Không thể kết nối đến URL Webhook: {exc}", retryable=True)


def _dispatch_wordpress(
    variant: PostVariant,
    cfg: Dict[str, Any],
    title: str,
    content: str,
    link_url: str,
    mock: bool,
) -> Dict[str, Any]:
    site_url = str(cfg.get("site_url") or cfg.get("siteUrl") or "").strip().rstrip("/")
    username = str(cfg.get("username") or "").strip()
    app_password = str(cfg.get("app_password") or cfg.get("appPassword") or "").strip()
    post_status = str(cfg.get("post_status") or "publish").strip()

    if not site_url or not username or not app_password:
        raise PublishAdapterError(
            "WordPress REST API thiếu địa chỉ site, username hoặc Application Password.",
            retryable=False,
        )

    if mock:
        return {
            "external_post_id": f"mock_wp_{variant.id}",
            "external_post_url": f"{site_url}/?p={variant.id}",
            "status": PostVariant.STATUS_PUBLISHED,
            "message": "[Mock Mode] Đã tạo bài viết trên WordPress giả lập.",
        }

    wp_url = f"{site_url}/wp-json/wp/v2/posts"
    post_body = {
        "title": title,
        "content": content,
        "status": post_status,
    }

    try:
        res = requests.post(wp_url, json=post_body, auth=(username, app_password), timeout=20)
        data = res.json()
        if res.status_code in {200, 201} and "id" in data:
            post_id = str(data["id"])
            post_link = data.get("link") or f"{site_url}/?p={post_id}"
            return {
                "external_post_id": post_id,
                "external_post_url": post_link,
                "status": PostVariant.STATUS_PUBLISHED,
                "message": f"Đã tạo bài thành công trên WordPress (ID #{post_id}).",
            }
        err_msg = data.get("message") if isinstance(data, dict) else res.text[:200]
        raise PublishAdapterError(
            f"WordPress từ chối tạo bài (HTTP {res.status_code}): {err_msg}",
            retryable=res.status_code >= 500,
        )
    except requests.RequestException as exc:
        raise PublishAdapterError(f"Không thể kết nối đến máy chủ WordPress: {exc}", retryable=True)


def _dispatch_manual_channel(
    variant: PostVariant,
    cfg: Dict[str, Any],
    title: str,
    content: str,
    link_url: str,
    mock: bool,
) -> Dict[str, Any]:
    """For Facebook Groups, Zalo Groups, etc.

    Never scrape or use unofficial APIs. Instead, send an in-app notification to the assigned creator with copyable
    content and group link.
    """
    creator_email = variant.plan.creator.email
    channel_name = variant.channel.name
    group_url = str(cfg.get("group_url") or cfg.get("groupUrl") or cfg.get("url") or "").strip()

    notify_workspace(
        event_key=f"manual_post_variant_{variant.id}",
        title=f"Nhắc đăng bài: {title} ({channel_name})",
        message=(
            f"Đã đến giờ đăng bài cho kênh '{channel_name}'. "
            f"Vui lòng vào ứng dụng để sao chép nội dung và đăng lên nhóm."
        ),
        severity="info",
        category="publishing",
        action_url=f"/communication-tools/publishing?variant={variant.id}",
        target_emails=[creator_email],
    )

    return {
        "external_post_id": f"notified_{variant.id}",
        "external_post_url": group_url,
        "status": PostVariant.STATUS_AWAITING_MANUAL,
        "message": f"Đã gửi thông báo nhắc nhở tới tài khoản {creator_email}.",
    }
