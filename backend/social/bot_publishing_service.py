import os
import logging
import requests
from django.utils import timezone
from .bot_models import FbDraftPost, FbPublishTarget
try:
    from publishing.models import PublishChannel
except ImportError:
    PublishChannel = None

logger = logging.getLogger(__name__)

def get_fb_target_credentials(target_id=None):
    """
    Lấy thông tin Fanpage đích (page_id, access_token, name).
    Thứ tự ưu tiên:
    1. PublishChannel active loại KIND_FACEBOOK_PAGE (nguồn kênh xuất bản chính thức).
    2. FbPublishTarget theo id hoặc target_id nếu được truyền.
    3. FbPublishTarget đầu tiên có target_type='page' và is_active=True (legacy fallback).
    """
    # 1. Ưu tiên PublishChannel (nguồn cấu hình chính thức từ Kênh xuất bản)
    if PublishChannel:
        chan_query = PublishChannel.objects.filter(kind=PublishChannel.KIND_FACEBOOK_PAGE, is_active=True)
        if target_id:
            if isinstance(target_id, int) or (isinstance(target_id, str) and str(target_id).isdigit()):
                c = chan_query.filter(id=int(target_id)).first()
                if c:
                    cfg = c.get_config() if hasattr(c, "get_config") else (getattr(c, "config", None) or {})
                    page_id = str(cfg.get("page_id") or cfg.get("pageId") or cfg.get("target_id") or "").strip()
                    access_token = str(cfg.get("access_token") or cfg.get("accessToken") or cfg.get("page_access_token") or "").strip()
                    if page_id and access_token:
                        return {
                            "page_id": page_id,
                            "access_token": access_token,
                            "name": c.name,
                            "target_obj": c,
                        }

        chan = chan_query.order_by("-updated_at", "-id").first()
        if chan:
            cfg = chan.get_config() if hasattr(chan, "get_config") else (getattr(chan, "config", None) or {})
            page_id = str(cfg.get("page_id") or cfg.get("pageId") or cfg.get("target_id") or "").strip()
            access_token = str(cfg.get("access_token") or cfg.get("accessToken") or cfg.get("page_access_token") or "").strip()
            if page_id and access_token:
                return {
                    "page_id": page_id,
                    "access_token": access_token,
                    "name": chan.name,
                    "target_obj": chan,
                }

    # 2. Legacy: FbPublishTarget theo id hoặc target_id
    if target_id:
        target = None
        if isinstance(target_id, int) or (isinstance(target_id, str) and str(target_id).isdigit()):
            target = FbPublishTarget.objects.filter(id=int(target_id)).first()
        if not target:
            target = FbPublishTarget.objects.filter(target_id=str(target_id)).first()
        if target and target.access_token:
            return {
                "page_id": target.target_id,
                "access_token": target.access_token,
                "name": target.name,
                "target_obj": target,
            }

    # 3. Legacy Fallback: FbPublishTarget active
    target = FbPublishTarget.objects.filter(target_type='page', is_active=True).first()
    if target and target.access_token:
        return {
            "page_id": target.target_id,
            "access_token": target.access_token,
            "name": target.name,
            "target_obj": target,
        }

    raise ValueError("Chưa cấu hình Fanpage Facebook (Page ID & Access Token) để xuất bản.")

def publish_draft_to_facebook(draft: FbDraftPost, target_id=None, force_republish=False):
    """
    Xuất bản bài viết FbDraftPost lên Facebook Fanpage.
    Cập nhật status -> 'published', published_at, fb_post_url.
    """
    if draft.status == "published" and draft.fb_post_url and not force_republish:
        logger.warning("Draft #%s đã xuất bản trước đó tại %s", draft.id, draft.fb_post_url)
        return {
            "id": draft.fb_post_url.rstrip("/").split("/")[-1],
            "url": draft.fb_post_url,
            "already_published": True,
        }

    creds = get_fb_target_credentials(target_id)
    page_id = creds["page_id"]
    access_token = creds["access_token"]
    target_name = creds["name"]

    parts = []
    if draft.title:
        parts.append(draft.title.strip())
    if draft.content:
        parts.append(draft.content.strip())
    if draft.hashtags:
        parts.append(draft.hashtags.strip())

    message = "\n\n".join(parts)

    mock_mode = (
        os.getenv("PUBLISH_MOCK_MODE") == "1"
        or not access_token
        or access_token.startswith("mock_")
        or access_token.startswith("test-")
    )

    if mock_mode:
        post_id = f"mock_{page_id}_{draft.id}"
        post_url = f"https://facebook.com/{page_id}/posts/{post_id}"
        draft.status = "published"
        draft.published_at = timezone.now()
        draft.fb_post_url = post_url
        draft.save(update_fields=["status", "published_at", "fb_post_url"])

        logger.info(
            "Bot 5 (Mock) published draft #%s to fanpage '%s': %s",
            draft.id, target_name, post_url
        )
        return {"id": post_id, "url": post_url}

    # Thực tế: Gọi Facebook Graph API
    images = [img for img in (draft.image_urls or []) if img and str(img).startswith("http")]
    if images and len(images) == 1:
        url = f"https://graph.facebook.com/v21.0/{page_id}/photos"
        payload = {
            "url": images[0],
            "caption": message,
            "access_token": access_token,
        }
    else:
        url = f"https://graph.facebook.com/v21.0/{page_id}/feed"
        payload = {
            "message": message,
            "access_token": access_token,
        }

    try:
        resp = requests.post(url, data=payload, timeout=25)
        data = resp.json()
    except Exception as e:
        logger.exception("Lỗi kết nối Facebook Graph API: %s", e)
        raise RuntimeError(f"Lỗi kết nối Facebook Graph API: {e}")

    if resp.status_code == 200 and "id" in data:
        post_id = data["id"]
        post_url = f"https://facebook.com/{post_id}"
        draft.status = "published"
        draft.published_at = timezone.now()
        draft.fb_post_url = post_url
        draft.save(update_fields=["status", "published_at", "fb_post_url"])

        logger.info(
            "Bot 5 published draft #%s to fanpage '%s' (post ID: %s)",
            draft.id, target_name, post_id
        )
        return {"id": post_id, "url": post_url}

    err_msg = data.get("error", {}).get("message", resp.text)
    logger.error("Facebook API rejected publish: %s", err_msg)
    raise RuntimeError(f"Facebook Graph API từ chối: {err_msg}")
