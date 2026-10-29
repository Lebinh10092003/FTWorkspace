from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

from mcp.streamable import streamable_http


def health(_request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/", include("authentication.urls")),
    path("api/", include("social.urls")),
    path("api/", include("examination.urls")),
    path("api/", include("email_builder.urls")),
    path("api/", include("digital_training.urls")),
    path("api/", include("attendance.urls")),
    path("api/", include("work_schedule.urls")),
    path("api/", include("documents.urls")),
    path("api/", include("company_accounts.urls")),
    path("api/chatbot/", include("chatbot.urls")),
    path("api/news-posts/", include("news_posts.urls")),
    path("api/", include("mcp.urls")),
    # OAuth 2.1 cho MCP: /.well-known/* va /api/oauth/*
    path("", include("mcp_oauth.urls")),
    # URL MCP ngan /mcp, giong /api/mcp (nginx chuyen /mcp vao Django).
    path("mcp", streamable_http, name="mcp_short"),
    path("mcp/", streamable_http),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
