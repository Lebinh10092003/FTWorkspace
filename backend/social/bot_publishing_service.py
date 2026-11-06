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
    1. FbPublishTarget theo id hoặc target_id nếu được truyền.
    2. FbPublishTarget đầu tiên có target_type='page' và is_active=True.
    3. PublishChannel đầu tiên có kind='facebook_page' và is_active=True.
    """
    if target_id:
        target = FbPublishTarget.objects.filter(id=target_id).first()
        if not target:
            target = FbPublishTarget.objects.filter(target_id=target_id).first()
        if target:
            return {
                "page_id": target.target_id,
                "access_token": target.access_token,
                "name": target.name,
                "target_obj": target,
            }

    # Fallback 1: FbPublishTarget active
    target = FbPublishTarget.objects.filter(target_type='page', is_active=True).first()
    if target:
        return {
            "page_id": target.target_id,
            "access_token": target.access_token,
            "name": target.name,
            "target_obj": target,
        }

    # Fallback 2: PublishChannel active
    if PublishChannel:
        chan = PublishChannel.objects.filter(kind='facebook_page', is_active=True).first()
        if chan:
            cfg = chan.config or {}
            page_id = cfg.get("page_id") or cfg.get("target_id") or chan.external_id
            access_token = cfg.get("access_token") or cfg.get("page_access_token")
            if page_id and access_token:
                return {
                    "page_id": page_id,
                    "access_token": access_token,
                    "name": chan.name,
                    "target_obj": chan,
                }

    raise ValueError("Chưa cấu hình Fanpage Facebook (Page ID & Access Token) để xuất bản.")

def publish_draft_to_facebook(draft: FbDraftPost, target_id=None):
    """
    Xuất bản bài viết FbDraftPost lên Facebook Fanpage.
    Cập nhật status -> 'published', published_at, fb_post_url.
    """
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
