from django.urls import path

from . import views

urlpatterns = [
    path("channels/", views.channels_list_create, name="publishing_channels"),
    path("channels/<int:pk>/", views.channel_detail, name="publishing_channel_detail"),
    path("channels/<int:pk>/test-connection/", views.channel_test_connection, name="publishing_channel_test"),
    path("plans/", views.post_plans_list_create, name="publishing_plans"),
    path("plans/<int:pk>/", views.post_plan_detail, name="publishing_plan_detail"),
    path("plans/<int:pk>/approve/", views.post_plan_approve, name="publishing_plan_approve"),
    path("plans/<int:pk>/generate-variants/", views.post_plan_generate_variants, name="publishing_plan_generate"),
    path("plans/<int:pk>/publish-now/", views.post_plan_publish_now, name="publishing_plan_publish_now"),
    path("variants/<int:pk>/", views.post_variant_detail, name="publishing_variant_detail"),
    path("variants/<int:pk>/mark-published/", views.post_variant_mark_published, name="publishing_variant_mark_published"),
    path("jobs/<int:pk>/", views.publish_job_status, name="publishing_job_status"),
]
