from django.urls import path
from . import views

app_name = "gmail_assistant"

urlpatterns = [
    path("status/", views.gmail_status_view, name="status"),
    path("oauth/authorize-url/", views.oauth_authorize_url_view, name="oauth_authorize_url"),
    path("oauth/callback/", views.oauth_callback_view, name="oauth_callback"),
    path("disconnect/", views.disconnect_view, name="disconnect"),
    path("settings/", views.update_settings_view, name="settings"),
    path("digests/", views.list_digests_view, name="list_digests"),
    path("digests/morning/", views.morning_digest_view, name="morning_digest"),
    path("digests/<int:digest_id>/status/", views.update_digest_status_view, name="update_digest_status"),
    path("digests/<int:digest_id>/draft-reply/", views.draft_reply_ai_view, name="draft_reply_ai"),
    path("digests/<int:digest_id>/toggle-action/", views.toggle_action_view, name="toggle_action"),
    path("digests/<int:digest_id>/analyze/", views.analyze_digest_view, name="analyze_digest"),
    path("digests/add-to-report/", views.add_to_report_view, name="add_to_report"),
    path("drafts/create/", views.create_draft_view, name="create_draft"),
    path("sync/", views.trigger_sync_view, name="trigger_sync"),
    path("jobs/<int:job_id>/", views.get_job_status_view, name="get_job_status"),
]
