from datetime import datetime
import re
import secrets
from urllib.parse import urlparse

from django.db import IntegrityError, transaction
from django.db.models import F, Q
from django.http import HttpResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.utils.html import escape
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from authentication.models import UserProfile
from authentication.permissions import IsWorkspaceAuthenticated
from .models import ShortLink

# Safe base62-like alphabet avoiding visually ambiguous characters (0/O, 1/I/l)
RANDOM_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CUSTOM_CODE_REGEX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,78}[A-Za-z0-9]$|^[A-Za-z0-9]{2,80}$")
RESERVED_CODES = {
    "api",
    "admin",
    "s",
    "mcp",
    "static",
    "uploads",
    "assets",
    "templates",
    "login",
    "logout",
    "workspace",
    "health",
}


def normalize_target_url(raw_url: str) -> str:
    value = str(raw_url or "").strip()
    if not value:
        raise ValueError("Vui lòng nhập đường dẫn gốc cần rút gọn.")
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", value):
        value = f"https://{value}"
    try:
        parsed = urlparse(value)
    except Exception as exc:
        raise ValueError("Đường dẫn không đúng định dạng.") from exc
    if parsed.scheme.lower() not in {"http", "https"}:
        raise ValueError("Chỉ hỗ trợ đường dẫn web bắt đầu bằng https:// hoặc http://.")
    hostname = str(parsed.hostname or "").strip().lower()
    if not hostname or ("." not in hostname and hostname != "localhost"):
        raise ValueError("Tên miền của đường dẫn không hợp lệ.")
    return value


def validate_custom_code(raw_code: str) -> str:
    code = str(raw_code or "").strip().strip("/")
    if not code:
        raise ValueError("Vui lòng nhập tên rút gọn tùy chỉnh.")
    if len(code) < 2 or len(code) > 80:
        raise ValueError("Tên rút gọn phải có độ dài từ 2 đến 80 ký tự.")
    if not CUSTOM_CODE_REGEX.match(code):
        raise ValueError(
            "Tên rút gọn chỉ gồm chữ cái không dấu, chữ số, dấu gạch ngang (-), gạch dưới (_) hoặc dấu chấm (.), không bắt đầu hoặc kết thúc bằng ký tự đặc biệt."
        )
    if code.lower() in RESERVED_CODES:
        raise ValueError("Tên rút gọn này trùng từ khóa hệ thống, vui lòng chọn tên khác.")
    return code


def generate_random_code(length: int = 6) -> str:
    size = max(4, min(16, int(length or 6)))
    for _ in range(30):
        candidate = "".join(secrets.choice(RANDOM_CODE_ALPHABET) for _ in range(size))
        if candidate.lower() not in RESERVED_CODES and not ShortLink.objects.filter(code__iexact=candidate).exists():
            return candidate
    return "".join(secrets.choice(RANDOM_CODE_ALPHABET) for _ in range(size + 2))


def parse_expires_at(raw_value):
    text = str(raw_value or "").strip()
    if not text:
        return None
    dt = parse_datetime(text)
    if dt is not None:
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt, timezone.get_current_timezone())
        return dt
    d = parse_date(text)
    if d is not None:
        dt = datetime(d.year, d.month, d.day, 23, 59, 59)
        return timezone.make_aware(dt, timezone.get_current_timezone())
    raise ValueError("Thời hạn hết hạn không đúng định dạng ngày/giờ.")


def build_short_url(request, code: str) -> str:
    try:
        origin = f"{request.scheme}://{request.get_host()}"
    except Exception:
        origin = "https://workspace.fermat.vn"
    return f"{origin}/s/{code}"


def short_link_payload(link: ShortLink, request=None) -> dict:
    now = timezone.now()
    is_expired = bool(link.expires_at and link.expires_at <= now)
    creator_email = link.created_by.email if link.created_by_id else ""
    creator_name = link.created_by_name or (link.created_by.name if link.created_by else "") or creator_email
    return {
        "id": link.pk,
        "code": link.code,
        "shortPath": f"/s/{link.code}",
        "shortUrl": build_short_url(request, link.code) if request else f"/s/{link.code}",
        "targetUrl": link.target_url,
        "title": link.title,
        "note": link.note,
        "isCustom": link.is_custom,
        "isActive": link.is_active,
        "isExpired": is_expired,
        "clicks": link.clicks,
        "lastClickedAt": link.last_clicked_at.isoformat() if link.last_clicked_at else None,
        "expiresAt": link.expires_at.isoformat() if link.expires_at else None,
        "createdByEmail": creator_email,
        "createdByName": creator_name,
        "createdAt": link.created_at.isoformat(),
        "updatedAt": link.updated_at.isoformat(),
    }


def _user_role(request) -> str:
    role = getattr(request, "user_role", None) or getattr(getattr(request, "user", None), "role", None)
    return str(role or "EMPLOYEE").upper()


def _can_modify_link(request, link: ShortLink) -> bool:
    if _user_role(request) in {"ADMIN", "MANAGER"}:
        return True
    email = str(getattr(request.user, "email", "") or "").strip().lower()
    return bool(email and link.created_by_id and link.created_by_id.lower() == email)


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceAuthenticated])
def short_links_view(request):
    if request.method == "GET":
        qs = ShortLink.objects.select_related("created_by").all()
        scope = str(request.query_params.get("scope") or "all").strip().lower()
        email = str(getattr(request.user, "email", "") or "").strip().lower()
        if scope == "mine" and email:
            qs = qs.filter(created_by__email__iexact=email)
        search = str(request.query_params.get("q") or "").strip()
        if search:
            qs = qs.filter(
                Q(code__icontains=search)
                | Q(title__icontains=search)
                | Q(target_url__icontains=search)
                | Q(note__icontains=search)
                | Q(created_by_name__icontains=search)
            )
        links = list(qs[:200])
        total_clicks = sum(item.clicks for item in links)
        active_count = sum(
            1
            for item in links
            if item.is_active and not (item.expires_at and item.expires_at <= timezone.now())
        )
        return Response(
            {
                "links": [short_link_payload(item, request=request) for item in links],
                "summary": {
                    "totalLinks": len(links),
                    "activeLinks": active_count,
                    "totalClicks": total_clicks,
                },
            }
        )

    data = request.data if isinstance(request.data, dict) else {}
    try:
        target_url = normalize_target_url(data.get("targetUrl") or data.get("url"))
        expires_at = parse_expires_at(data.get("expiresAt"))
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    mode = str(data.get("mode") or "").strip().lower()
    raw_custom_code = str(data.get("customCode") or data.get("code") or "").strip()
    is_custom = mode == "custom" or bool(raw_custom_code and mode != "random")

    if is_custom:
        try:
            code = validate_custom_code(raw_custom_code)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if ShortLink.objects.filter(code__iexact=code).exists():
            return Response(
                {"error": f"Tên rút gọn '{code}' đã được sử dụng. Vui lòng chọn tên khác hoặc tạo ngẫu nhiên."},
                status=status.HTTP_409_CONFLICT,
            )
    else:
        try:
            random_length = int(data.get("randomLength") or 6)
        except (TypeError, ValueError):
            random_length = 6
        code = generate_random_code(random_length)

    title = str(data.get("title") or "").strip()[:255]
    note = str(data.get("note") or "").strip()[:2000]
    user_email = str(getattr(request.user, "email", "") or "").strip().lower()
    profile = UserProfile.objects.filter(email__iexact=user_email).first() if user_email else None
    creator_name = (
        (profile.name if profile and profile.name else "")
        or str(getattr(request.user, "name", "") or "").strip()
        or user_email
    )

    try:
        with transaction.atomic():
            link = ShortLink.objects.create(
                code=code,
                target_url=target_url,
                title=title,
                note=note,
                is_custom=is_custom,
                is_active=True,
                expires_at=expires_at,
                created_by=profile,
                created_by_name=creator_name[:255],
            )
    except IntegrityError:
        return Response(
            {"error": f"Tên rút gọn '{code}' vừa được người khác tạo. Vui lòng thử lại."},
            status=status.HTTP_409_CONFLICT,
        )

    return Response(short_link_payload(link, request=request), status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def short_link_check_code(request):
    raw_code = str(request.query_params.get("code") or "").strip()
    exclude_id = str(request.query_params.get("excludeId") or "").strip()
    if not raw_code:
        return Response({"available": False, "error": "Chưa nhập mã rút gọn."})
    try:
        code = validate_custom_code(raw_code)
    except ValueError as exc:
        return Response({"available": False, "code": raw_code, "error": str(exc)})
    qs = ShortLink.objects.filter(code__iexact=code)
    if exclude_id.isdigit():
        qs = qs.exclude(pk=int(exclude_id))
    exists = qs.exists()
    return Response(
        {
            "available": not exists,
            "code": code,
            "error": "" if not exists else f"Tên rút gọn '{code}' đã tồn tại.",
        }
    )


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def short_link_random_code(request):
    data = request.data if isinstance(request.data, dict) else {}
    try:
        length = int(data.get("length") or request.query_params.get("length") or 6)
    except (TypeError, ValueError):
        length = 6
    code = generate_random_code(length)
    return Response({"code": code, "shortPath": f"/s/{code}", "shortUrl": build_short_url(request, code)})


@api_view(["PATCH", "PUT", "DELETE"])
@permission_classes([IsWorkspaceAuthenticated])
def short_link_detail_view(request, link_id: int):
    link = get_object_or_404(ShortLink.objects.select_related("created_by"), pk=link_id)
    if not _can_modify_link(request, link):
        return Response(
            {"error": "Bạn chỉ có thể chỉnh sửa hoặc xóa liên kết rút gọn do chính mình tạo."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if request.method == "DELETE":
        link.delete()
        return Response({"deleted": True, "id": link_id})

    data = request.data if isinstance(request.data, dict) else {}
    update_fields = ["updated_at"]

    if "targetUrl" in data or "url" in data:
        try:
            link.target_url = normalize_target_url(data.get("targetUrl") or data.get("url"))
            update_fields.append("target_url")
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    if "customCode" in data or "code" in data:
        new_raw_code = str(data.get("customCode") or data.get("code") or "").strip()
        if new_raw_code and new_raw_code != link.code:
            try:
                validated_code = validate_custom_code(new_raw_code)
            except ValueError as exc:
                return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            if ShortLink.objects.filter(code__iexact=validated_code).exclude(pk=link.pk).exists():
                return Response(
                    {"error": f"Tên rút gọn '{validated_code}' đã được sử dụng."},
                    status=status.HTTP_409_CONFLICT,
                )
            link.code = validated_code
            link.is_custom = True
            update_fields.extend(["code", "is_custom"])

    if "title" in data:
        link.title = str(data.get("title") or "").strip()[:255]
        update_fields.append("title")

    if "note" in data:
        link.note = str(data.get("note") or "").strip()[:2000]
        update_fields.append("note")

    if "isActive" in data:
        link.is_active = bool(data.get("isActive"))
        update_fields.append("is_active")

    if "expiresAt" in data:
        try:
            link.expires_at = parse_expires_at(data.get("expiresAt"))
            update_fields.append("expires_at")
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    try:
        link.save(update_fields=list(dict.fromkeys(update_fields)))
    except IntegrityError:
        return Response(
            {"error": "Tên rút gọn bị trùng, vui lòng chọn tên khác."},
            status=status.HTTP_409_CONFLICT,
        )

    return Response(short_link_payload(link, request=request))


def _render_link_error_page(title: str, message: str, status_code: int) -> HttpResponse:
    safe_title = escape(title)
    safe_message = escape(message)
    html = f"""<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{safe_title} — FermatTech</title>
  <style>
    body {{
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: "Be Vietnam Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #F3F6FA;
      color: #0F1F33;
      padding: 24px;
    }}
    .card {{
      max-width: 480px;
      width: 100%;
      background: #FFFFFF;
      border: 1px solid #DDE5EF;
      border-radius: 20px;
      padding: 32px;
      box-shadow: 0 10px 30px rgba(15, 31, 51, 0.06);
      text-align: center;
    }}
    .badge {{
      display: inline-block;
      padding: 6px 12px;
      border-radius: 999px;
      background: #FEF2F2;
      color: #DC2626;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }}
    h1 {{
      margin: 16px 0 8px;
      font-size: 22px;
      font-weight: 800;
      color: #001E40;
    }}
    p {{
      margin: 0 0 24px;
      font-size: 14px;
      line-height: 1.6;
      color: #4A5B70;
    }}
    a {{
      display: inline-block;
      text-decoration: none;
      background: #0B72CE;
      color: #FFFFFF;
      font-weight: 700;
      font-size: 14px;
      padding: 12px 22px;
      border-radius: 12px;
    }}
    a:hover {{
      background: #075CA8;
    }}
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Liên kết rút gọn</span>
    <h1>{safe_title}</h1>
    <p>{safe_message}</p>
    <a href="/">Về trang chủ FermatTech Workspace</a>
  </div>
</body>
</html>"""
    return HttpResponse(html, status=status_code, content_type="text/html; charset=utf-8")


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def resolve_short_link_api(request, code: str):
    """JSON endpoint to resolve a short link from the SPA fallback if needed."""
    cleaned = str(code or "").strip().strip("/")
    link = ShortLink.objects.filter(code__iexact=cleaned).first()
    if not link:
        return Response({"error": "Không tìm thấy liên kết rút gọn này."}, status=status.HTTP_404_NOT_FOUND)
    if not link.is_active:
        return Response({"error": "Liên kết rút gọn này đang tạm khóa."}, status=status.HTTP_410_GONE)
    if link.expires_at and link.expires_at <= timezone.now():
        return Response({"error": "Liên kết rút gọn này đã hết hạn."}, status=status.HTTP_410_GONE)

    ShortLink.objects.filter(pk=link.pk).update(
        clicks=F("clicks") + 1,
        last_clicked_at=timezone.now(),
    )
    return Response(
        {
            "code": link.code,
            "targetUrl": link.target_url,
            "title": link.title,
        }
    )


def redirect_short_link(request, code: str):
    """Direct HTTP 302 redirect for /s/<code>."""
    cleaned = str(code or "").strip().strip("/")
    link = ShortLink.objects.filter(code__iexact=cleaned).first()
    if not link:
        return _render_link_error_page(
            "Không tìm thấy liên kết",
            f"Đường dẫn rút gọn /s/{cleaned} không tồn tại hoặc đã bị xóa.",
            status.HTTP_404_NOT_FOUND,
        )
    if not link.is_active:
        return _render_link_error_page(
            "Liên kết đang tạm khóa",
            "Người quản trị đã tạm dừng chuyển hướng cho đường dẫn rút gọn này.",
            status.HTTP_410_GONE,
        )
    if link.expires_at and link.expires_at <= timezone.now():
        return _render_link_error_page(
            "Liên kết đã hết hạn",
            "Thời hạn truy cập của đường dẫn rút gọn này đã kết thúc.",
            status.HTTP_410_GONE,
        )

    ShortLink.objects.filter(pk=link.pk).update(
        clicks=F("clicks") + 1,
        last_clicked_at=timezone.now(),
    )
    response = HttpResponseRedirect(link.target_url)
    response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response

