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
    val = (os.getenv("PUBLISH_MOCK_MODE") or os.getenv("MOCK_EXTERNAL_SERVICES") or "").strip().lower()
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
        token = str(cfg.get("access_token") or cfg.get("accessToken") or cfg.get("page_access_token") or "").strip()
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
            p_res = requests.get(
                f"https://graph.facebook.com/{META_GRAPH_VERSION}/{page_id}",
                params={"fields": "id,name", "access_token": token},
                timeout=10,
            )
            try:
                p_data = p_res.json()
            except Exception:
                p_data = {}

            if p_res.status_code != 200 or "error" in p_data:
                err = p_data.get("error", {}).get("message", f"HTTP {p_res.status_code}")
                return {"success": False, "message": f"Không thể kết nối Page ID {page_id}: {err}"}

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

    elif channel.kind == PublishChannel.KIND_ZALO_PERSONAL_GROUP:
        group_name = str(cfg.get("group_name") or cfg.get("groupName") or channel.name or "").strip()
        if not group_name:
            return {
                "success": False,
                "message": "Thiếu tên nhóm Zalo cần đăng bài.",
            }
        from .zalo_automation import get_zalo_session_status

        status = get_zalo_session_status(session_id=str(channel.id))
        if not mock and not status.get("is_authenticated"):
            return {
                "success": False,
                "message": "Chưa kết nối tài khoản Zalo cá nhân trên Server VPS. Vui lòng quét mã QR để đăng nhập.",
                "details": status,
            }
        return {
            "success": True,
            "message": f"Kênh Zalo sẵn sàng tự động đăng vào nhóm '{group_name}'.",
            "details": {"group_name": group_name, **status},
        }

    elif channel.kind == PublishChannel.KIND_ZALO_OA:
        return {
            "success": False,
            "message": "Zalo Official Account đang ở chế độ adapter mở rộng, vui lòng liên hệ quản trị khi có tài khoản OA.",
        }

    elif channel.kind == PublishChannel.KIND_EMAIL_NEWSLETTER:
        mode = str(cfg.get("mode") or "smtp").lower()
        if mode == "gmail_oauth":
            from gmail_assistant.models import GmailConnection
            user = channel.owner
            conn = GmailConnection.objects.filter(user=user, is_active=True).first() if user else None
            if not mock and not conn:
                return {
                    "success": False,
                    "message": "Người tạo kênh chưa liên kết tài khoản Gmail OAuth trong mục Trợ lý Gmail.",
                }
            email_addr = conn.email_address if conn else "demo@fermat.vn"
            return {
                "success": True,
                "message": f"Kênh sẵn sàng gửi bản thảo qua tài khoản Gmail OAuth '{email_addr}'.",
                "details": {"mode": "gmail_oauth", "email": email_addr},
            }
        else:
            host = str(cfg.get("smtp_host") or "smtp.gmail.com").strip()
            port = int(cfg.get("smtp_port") or 587)
            username = str(cfg.get("smtp_username") or cfg.get("from_email") or "").strip()
            password = str(cfg.get("smtp_password") or cfg.get("app_password") or "").strip()
            if not username:
                return {
                    "success": False,
                    "message": "Vui lòng nhập Email người gửi (SMTP Username / From Email).",
                }
            if mock:
                return {
                    "success": True,
                    "message": f"[Mock Mode] Kết nối máy chủ SMTP {host}:{port} thành công cho '{username}'.",
                    "details": {"smtp_host": host, "port": port, "username": username},
                }
            import smtplib
            try:
                if port == 465:
                    server = smtplib.SMTP_SSL(host, port, timeout=10)
                else:
                    server = smtplib.SMTP(host, port, timeout=10)
                    server.starttls()
                if password:
                    server.login(username, password)
                server.quit()
                return {
                    "success": True,
                    "message": f"Kết nối SMTP {host}:{port} thành công cho tài khoản '{username}'.",
                    "details": {"smtp_host": host, "port": port, "username": username},
                }
            except Exception as exc:
                return {
                    "success": False,
                    "message": f"Không thể kết nối đến máy chủ SMTP ({host}:{port}): {exc}",
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

    elif channel.kind == PublishChannel.KIND_ZALO_PERSONAL_GROUP:
        return _dispatch_zalo_personal_group(variant, cfg, title, content, link_url, mock)

    elif channel.kind == PublishChannel.KIND_EMAIL_NEWSLETTER:
        return _dispatch_email_newsletter(variant, cfg, title, content, link_url, mock)

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
    token = str(cfg.get("access_token") or cfg.get("accessToken") or cfg.get("page_access_token") or "").strip()

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


def _dispatch_zalo_personal_group(
    variant: PostVariant,
    cfg: Dict[str, Any],
    title: str,
    content: str,
    link_url: str,
    mock: bool,
) -> Dict[str, Any]:
    group_name = str(cfg.get('group_name') or cfg.get('groupName') or variant.channel.name or '').strip()
    if not group_name:
        raise PublishAdapterError('Kênh Zalo chưa được cấu hình tên nhóm đích.', retryable=False)

    full_content = f'{title}\n\n{content}'.strip() if title else content
    if link_url:
        full_content = f'{full_content}\n\n{link_url}'.strip()

    if mock:
        return {
            'external_post_id': f'mock_zalo_{variant.id}',
            'external_post_url': 'https://chat.zalo.me/',
            'status': PostVariant.STATUS_PUBLISHED,
            'message': f"[Mock Mode] Đã gửi bài viết thành công vào nhóm Zalo '{group_name}'.",
        }

    from .zalo_automation import send_zalo_personal_group_message, ZaloAutomationError
    try:
        res = send_zalo_personal_group_message(group_name=group_name, content=full_content, session_id=str(variant.channel_id))
        return {
            'external_post_id': f'zalo_{variant.id}',
            'external_post_url': 'https://chat.zalo.me/',
            'status': PostVariant.STATUS_PUBLISHED,
            'message': res.get('message') or f"Đã gửi bài vào nhóm Zalo '{group_name}'.",
        }
    except ZaloAutomationError as exc:
        raise PublishAdapterError(str(exc), retryable=False) from exc


def _render_email_newsletter_html(title: str, content: str, link_url: str, sender_name: str) -> str:
    """Render a clean responsive HTML newsletter body for email clients."""
    import html
    safe_title = html.escape(title or "Bản tin FermatTech")
    paragraphs = [p.strip() for p in (content or "").split("\n") if p.strip()]
    body_html = "".join(f"<p style='margin:0 0 16px 0;line-height:1.6;color:#374151;'>{html.escape(p)}</p>" for p in paragraphs)
    
    cta_html = ""
    if link_url:
        safe_url = html.escape(link_url)
        cta_html = (
            f"<div style='margin:28px 0;text-align:center;'>"
            f"<a href='{safe_url}' style='background-color:#2563eb;color:#ffffff;padding:12px 24px;"
            f"border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;'>Xem chi tiết bài viết</a>"
            f"</div>"
        )
    
    safe_sender = html.escape(sender_name or "FermatTech Team")
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{safe_title}</title>
</head>
<body style="margin:0;padding:24px;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table width="600" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding:32px 32px 16px 32px;background:linear-gradient(135deg,#1e3a8a,#3b82f6);color:#ffffff;">
              <h1 style="margin:0;font-size:22px;font-weight:700;line-height:1.3;">{safe_title}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              {body_html}
              {cta_html}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
              <p style="margin:0 0 4px 0;">Bản tin được phát hành tự động từ hệ thống {safe_sender}.</p>
              <p style="margin:0;">Nếu bạn không muốn nhận email này, vui lòng bỏ qua hoặc liên hệ ban quản trị.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _dispatch_email_newsletter(
    variant: PostVariant,
    cfg: Dict[str, Any],
    title: str,
    content: str,
    link_url: str,
    mock: bool,
) -> Dict[str, Any]:
    """Dispatch email newsletter to recipient list using Gmail OAuth or standard SMTP."""
    mode = str(cfg.get("mode") or "smtp").lower()
    from_name = str(cfg.get("from_name") or cfg.get("sender_name") or "FermatTech Newsletter").strip()
    subject = title or "Bản tin FermatTech"
    
    recipients_raw = cfg.get("recipients") or cfg.get("to_emails") or []
    if isinstance(recipients_raw, str):
        recipients = [e.strip() for e in recipients_raw.replace(";", ",").split(",") if e.strip()]
    elif isinstance(recipients_raw, list):
        recipients = [str(e).strip() for e in recipients_raw if str(e).strip()]
    else:
        recipients = []

    if not recipients:
        raise PublishAdapterError("Kênh Email Newsletter chưa có danh sách email người nhận.", retryable=False)

    html_body = _render_email_newsletter_html(title, content, link_url, from_name)

    if mock:
        return {
            "external_post_id": f"mock_email_{variant.id}",
            "external_post_url": f"mailto:{recipients[0]}",
            "status": PostVariant.STATUS_PUBLISHED,
            "message": f"[Mock Mode] Đã gửi bản tin email giả lập tới {len(recipients)} người nhận.",
        }

    if mode == "gmail_oauth":
        from gmail_assistant.models import GmailConnection
        from gmail_assistant.gmail_client import GmailClient
        user = variant.channel.owner
        conn = GmailConnection.objects.filter(user=user, is_active=True).first() if user else None
        if not conn:
            raise PublishAdapterError("Chưa liên kết tài khoản Gmail OAuth trong Trợ lý Gmail.", retryable=False)
        
        client = GmailClient(conn)
        # Note: In accordance with GmailSafetyNoSendCodeScanTests, gmail_assistant creates drafts for safety.
        # Create draft newsletter for the owner to review/send.
        draft = client.create_draft(
            thread_id=f"pub_{variant.id}",
            to_email=",".join(recipients),
            subject=subject,
            body_text=content,
        )
        return {
            "external_post_id": draft.get("id") or f"draft_{variant.id}",
            "external_post_url": "https://mail.google.com/mail/u/0/#drafts",
            "status": PostVariant.STATUS_PUBLISHED,
            "message": f"Đã tạo bản thảo Newsletter trong Gmail ({conn.email_address}) cho {len(recipients)} người nhận.",
        }
    else:
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        import smtplib

        host = str(cfg.get("smtp_host") or "smtp.gmail.com").strip()
        port = int(cfg.get("smtp_port") or 587)
        username = str(cfg.get("smtp_username") or cfg.get("from_email") or "").strip()
        password = str(cfg.get("smtp_password") or cfg.get("app_password") or "").strip()
        from_email = str(cfg.get("from_email") or username).strip()

        if not from_email:
            raise PublishAdapterError("Thiếu thông tin Email người gửi (From Email / SMTP username).", retryable=False)

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{from_name} <{from_email}>"
        msg["To"] = recipients[0]
        if len(recipients) > 1:
            msg["Bcc"] = ", ".join(recipients[1:])

        part_text = MIMEText(content or "", "plain", "utf-8")
        part_html = MIMEText(html_body, "html", "utf-8")
        msg.attach(part_text)
        msg.attach(part_html)

        try:
            if port == 465:
                server = smtplib.SMTP_SSL(host, port, timeout=15)
            else:
                server = smtplib.SMTP(host, port, timeout=15)
                server.starttls()
            if password:
                server.login(username, password)
            server.sendmail(from_email, recipients, msg.as_string())
            server.quit()
        except Exception as exc:
            raise PublishAdapterError(f"Gửi email qua SMTP ({host}:{port}) thất bại: {exc}", retryable=True) from exc

        return {
            "external_post_id": f"smtp_{variant.id}",
            "external_post_url": f"mailto:{recipients[0]}",
            "status": PostVariant.STATUS_PUBLISHED,
            "message": f"Đã gửi thành công bản tin email tới {len(recipients)} người nhận.",
        }

