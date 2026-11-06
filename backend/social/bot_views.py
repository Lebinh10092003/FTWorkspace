import json
import logging
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from .bot_models import FbBotProfile, FbMaterialUpload, FbDraftPost, FbPublishTarget
from . import bot_ai_service

logger = logging.getLogger(__name__)

def bot_drafts_list(request):
    """GET: Lấy danh sách các bài viết dự thảo và trạng thái."""
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    
    drafts = FbDraftPost.objects.all().order_by("-created_at")[:50]
    items = []
    for d in drafts:
        items.append({
            "id": d.id,
            "title": d.title,
            "content": d.content,
            "hashtags": d.hashtags,
            "status": d.status,
            "bot_creator": d.bot_creator,
            "created_at": d.created_at.strftime("%H:%M %d/%m/%Y"),
            "published_at": d.published_at.strftime("%H:%M %d/%m/%Y") if d.published_at else None,
            "fb_post_url": d.fb_post_url,
            "image_urls": d.image_urls,
        })
    return JsonResponse({"status": "ok", "drafts": items})

@csrf_exempt
def bot_create_task(request):
    """POST: Nạp tư liệu và kích hoạt Bot 2 -> Bot 3 -> Bot 4 soạn thảo và chấm điểm."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    
    try:
        body = json.loads(request.body.decode("utf-8"))
    except Exception:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    
    title = body.get("title", "").strip()
    content = body.get("content", "").strip()
    target_type = body.get("target_type", "page")
    author = getattr(getattr(request, "user", None), "email", "Người dùng Khảo thí")
    
    if not title or not content:
        return JsonResponse({"error": "Tiêu đề và nội dung tư liệu không được để trống."}, status=400)
    
    # 1. Lưu tư liệu
    material = FbMaterialUpload.objects.create(
        title=title,
        content=content,
        author=author or "User"
    )
    
    # 2. Bot 2: Tóm tắt
    summary = bot_ai_service.extract_material_summary(title, content)
    
    # 3. Bot 3: Soạn bài
    post = bot_ai_service.generate_fb_post(title, summary, target_type)
    
    # 4. Bot 4: Kiểm duyệt & Chấm điểm
    review = bot_ai_service.review_fb_post(post["title"], post["content"], post["hashtags"])
    
    # 5. Lưu bài dự thảo
    draft = FbDraftPost.objects.create(
        title=post["title"],
        content=post["content"],
        hashtags=post["hashtags"],
        status="pending",
        bot_creator="AI Soạn thảo",
    )
    
    return JsonResponse({
        "status": "ok",
        "draft": {
            "id": draft.id,
            "title": draft.title,
            "content": draft.content,
            "hashtags": draft.hashtags,
            "status": draft.status,
            "reviewScore": review["score"],
            "reviewNotes": review["notes"],
            "created_at": draft.created_at.strftime("%H:%M %d/%m/%Y"),
        }
    })

@csrf_exempt
def bot_approve_draft(request):
    """POST: Người dùng phê duyệt bài viết."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    try:
        body = json.loads(request.body.decode("utf-8"))
        draft_id = body.get("id")
        draft = FbDraftPost.objects.get(id=draft_id)
        draft.status = "approved"
        draft.save(update_fields=["status"])
        return JsonResponse({"status": "ok", "id": draft.id, "new_status": "approved"})
    except FbDraftPost.DoesNotExist:
        return JsonResponse({"error": "Không tìm thấy bài viết"}, status=404)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=400)

@csrf_exempt
def bot_publish_draft(request):
    """POST: Bot 5 xuất bản bài viết lên Facebook."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    try:
        body = json.loads(request.body.decode("utf-8"))
        draft_id = body.get("id")
        draft = FbDraftPost.objects.get(id=draft_id)
        draft.status = "published"
        draft.published_at = timezone.now()
        draft.fb_post_url = f"https://facebook.com/fermat.vn/posts/{draft.id}"
        draft.save(update_fields=["status", "published_at", "fb_post_url"])
        return JsonResponse({
            "status": "ok",
            "id": draft.id,
            "new_status": "published",
            "fb_post_url": draft.fb_post_url
        })
    except FbDraftPost.DoesNotExist:
        return JsonResponse({"error": "Không tìm thấy bài viết"}, status=404)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=400)
