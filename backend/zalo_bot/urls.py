from django.urls import path
from . import views

urlpatterns = [
    path("webhook/", views.webhook_view, name="zalo_bot_webhook"),
    path("status/", views.user_status_view, name="zalo_bot_status"),
    path("link-code/", views.generate_link_code_view, name="zalo_bot_link_code"),
    path("preferences/", views.update_preferences_view, name="zalo_bot_preferences"),
    path("test-send/", views.test_send_view, name="zalo_bot_test_send"),
    path("unlink/", views.unlink_view, name="zalo_bot_unlink"),
]
