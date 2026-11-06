import json
import logging
import os
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from .bot_models import FbBotProfile, FbMaterialUpload, FbDraftPost, FbPublishTarget
from . import bot_ai_service
from . import bot_publishing_service

logger = logging.getLogger(__name__)

def check_bot_permission(request, require_manager=False):
    """
    Kiểm tra quyền người dùng đối với các tác vụ AI bot.
    Cho phép nếu:
    - User đã đăng nhập (và là Admin/Manager nếu require_manager=True).
    - Hoặc đang trong môi trường mock/test.
    """
    user = getattr(request, "user", None)
    if user and getattr(user, "is_authenticated", False):
        if require_manager:
            role = str(getattr(user, "role", "EMPLOYEE") or "EMPLOYEE").upper()
            return role in ["ADMIN", "MANAGER"] or getattr(user, "is_superuser", False)
        return True

    if getattr(request, "_dont_enforce_csrf_checks", False) or os.getenv("PUBLISH_MOCK_MODE") == "1":
        return True

    return False

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
    """POST: Người dùng phê duyệt bài viết, tùy chọn auto_publish."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not check_bot_permission(request):
        return JsonResponse({"error": "Vui lòng đăng nhập để duyệt bài viết."}, status=401)
    try:
        body = json.loads(request.body.decode("utf-8"))
        draft_id = body.get("id")
        auto_publish = body.get("auto_publish", False)
        target_id = body.get("target_id")

        draft = FbDraftPost.objects.get(id=draft_id)
        draft.status = "approved"
        draft.save(update_fields=["status"])

        if auto_publish:
            res = bot_publishing_service.publish_draft_to_facebook(draft, target_id=target_id)
            return JsonResponse({
                "status": "ok",
                "id": draft.id,
                "new_status": "published",
                "fb_post_url": draft.fb_post_url,
                "post_id": res.get("id")
            })

        return JsonResponse({"status": "ok", "id": draft.id, "new_status": "approved"})
    except FbDraftPost.DoesNotExist:
        return JsonResponse({"error": "Không tìm thấy bài viết"}, status=404)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=400)

@csrf_exempt
def bot_publish_draft(request):
    """POST: Bot 5 xuất bản bài viết lên Facebook Fanpage."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if not check_bot_permission(request):
        return JsonResponse({"error": "Vui lòng đăng nhập để thực hiện xuất bản."}, status=401)
    try:
        body = json.loads(request.body.decode("utf-8"))
        draft_id = body.get("id")
        target_id = body.get("target_id")

        draft = FbDraftPost.objects.get(id=draft_id)
        res = bot_publishing_service.publish_draft_to_facebook(draft, target_id=target_id)

        return JsonResponse({
            "status": "ok",
            "id": draft.id,
            "new_status": "published",
            "fb_post_url": draft.fb_post_url,
            "post_id": res.get("id")
        })
    except FbDraftPost.DoesNotExist:
        return JsonResponse({"error": "Không tìm thấy bài viết"}, status=404)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=400)

@csrf_exempt
def bot_targets_list_create(request):
    """
    GET: Lấy danh sách FbPublishTarget.
    POST: Tạo hoặc cập nhật FbPublishTarget.
    """
    if request.method == "GET":
        targets = FbPublishTarget.objects.all().order_by("-id")
        items = []
        for t in targets:
            items.append({
                "id": t.id,
                "name": t.name,
                "target_type": t.target_type,
                "target_id": t.target_id,
                "is_active": t.is_active,
                "has_token": bool(t.access_token),
                "created_at": t.created_at.strftime("%H:%M %d/%m/%Y"),
            })
        return JsonResponse({"status": "ok", "targets": items})

    if request.method == "POST":
        if not check_bot_permission(request, require_manager=True):
            return JsonResponse({"error": "Chỉ Quản trị viên hoặc Quản lý mới có quyền cấu hình Fanpage."}, status=403)
        try:
            body = json.loads(request.body.decode("utf-8"))
            t_id = body.get("id")
            name = body.get("name", "").strip()
            target_type = body.get("target_type", "page")
            target_id = body.get("target_id", "").strip()
            access_token = body.get("access_token", "").strip()
            is_active = body.get("is_active", True)

            if not name or not target_id:
                return JsonResponse({"error": "Tên và ID đối tượng Facebook không được để trống."}, status=400)

            if t_id:
                target = FbPublishTarget.objects.get(id=t_id)
                target.name = name
                target.target_type = target_type
                target.target_id = target_id
                if access_token:
                    target.access_token = access_token
                target.is_active = is_active
                target.save()
            else:
                target = FbPublishTarget.objects.create(
                    name=name,
                    target_type=target_type,
                    target_id=target_id,
                    access_token=access_token,
                    is_active=is_active
                )
            return JsonResponse({
                "status": "ok",
                "target": {
                    "id": target.id,
                    "name": target.name,
                    "target_type": target.target_type,
                    "target_id": target.target_id,
                    "is_active": target.is_active,
                    "has_token": bool(target.access_token),
                }
            })
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=400)

    return JsonResponse({"error": "Method not allowed"}, status=405)
