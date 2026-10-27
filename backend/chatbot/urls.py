from django.urls import path

from . import views

urlpatterns = [
    path("history/", views.chat_history, name="chatbot_history"),
    path("history/clear/", views.clear_chat_history, name="chatbot_clear_history"),
    path("send/", views.send_chat_message, name="chatbot_send"),
    path("jobs/<int:job_id>/status/", views.chat_job_status, name="chatbot_job_status"),
    path("jobs/<int:job_id>/cancel/", views.cancel_chat_request, name="chatbot_job_cancel"),
    path("actions/<uuid:action_id>/confirm/", views.confirm_chat_action, name="chatbot_action_confirm"),
    path("actions/<uuid:action_id>/cancel/", views.cancel_chat_action, name="chatbot_action_cancel"),
    path("health/", views.chatbot_health, name="chatbot_health"),
]
