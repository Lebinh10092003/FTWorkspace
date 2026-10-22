from __future__ import annotations

from typing import Any, Dict
from social.models import Channel, Post
from .registry import register_tool


@register_tool(
    name="social_get_summary",
    description="Tra cứu tổng hợp chỉ số truyền thông mạng xã hội của FermatTech (các kênh Facebook Fanpage, Zalo OA, số người theo dõi, bài đăng gần nhất).",
    module="social-dashboard",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
)
def social_get_summary(ctx: Dict[str, Any], **_kwargs) -> Dict[str, Any]:
    channels = Channel.objects.filter(status="active")

    channel_list = []
    for c in channels:
        recent_posts = Post.objects.filter(channel_id=c.id, is_deleted=False).order_by("-published_at")[:3]
        posts_data = [
            {
                "message": (p.message or "")[:150],
                "published_at": p.published_at.isoformat(),
                "post_url": p.post_url,
                "type": p.post_type,
            }
            for p in recent_posts
        ]

        channel_list.append({
            "name": c.name,
            "platform": c.platform,
            "followers": c.followers_count,
            "total_posts": c.total_posts,
            "last_sync": c.last_sync_at.isoformat() if c.last_sync_at else None,
            "recent_posts": posts_data,
        })

    return {
        "channels_count": len(channel_list),
        "channels": channel_list,
    }
