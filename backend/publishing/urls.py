from django.urls import path

from . import views

urlpatterns = [
    path("channels/", views.channels_list_create, name="publishing_channels"),
    path("channels/<int:pk>/", views.channel_detail, name="publishing_channel_detail"),
    path("channels/<int:pk>/test-connection/", views.channel_test_connection, name="publishing_channel_test"),
    path("channels/<int:pk>/test/", views.channel_test_connection, name="publishing_channel_test_alias"),
    path("plans/", views.post_plans_list_create, name="publishing_plans"),
    path("plans/<int:pk>/", views.post_plan_detail, name="publishing_plan_detail"),
    path("plans/<int:pk>/approve/", views.post_plan_approve, name="publishing_plan_approve"),
    path("plans/<int:pk>/generate-variants/", views.post_plan_generate_variants, name="publishing_plan_generate"),
    path("plans/<int:pk>/publish-now/", views.post_plan_publish_now, name="publishing_plan_publish_now"),
    path("variants/<int:pk>/", views.post_variant_detail, name="publishing_variant_detail"),
    path("variants/<int:pk>/mark-published/", views.post_variant_mark_published, name="publishing_variant_mark_published"),
    path('variants/<int:pk>/publish-now/', views.post_variant_publish_now, name='publishing_variant_publish_now'),
    path("jobs/<int:pk>/", views.publish_job_status, name="publishing_job_status"),
    path("tech-discovery/topics/", views.tech_discovery_topics, name="publishing_tech_discovery_topics"),
    path("tech-discovery/trigger/", views.tech_discovery_trigger, name="publishing_tech_discovery_trigger"),
    path("tech-discovery/<int:topic_id>/create-plan/", views.tech_discovery_create_plan, name="publishing_tech_discovery_create_plan"),
    path('zalo-automation/status/', views.zalo_automation_status, name='publishing_zalo_status'),
    path('zalo-automation/qr/', views.zalo_automation_qr, name='publishing_zalo_qr'),
]
