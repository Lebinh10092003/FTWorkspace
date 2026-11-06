from django.urls import path
from . import views
from . import bot_views

urlpatterns = [
    path('channels', views.channels_list, name='channels_list'),
    path('channels/<str:channel_id>', views.channel_detail, name='channel_detail'),
    path('channels/<str:channel_id>/test-connection', views.channel_test_connection, name='channel_test_connection'),
    path('channels/<str:channel_id>/sync', views.channel_sync, name='channel_sync'),
    path('media-summary/trend', views.media_summary_trend, name='media_summary_trend'),
    path('media-summary', views.media_summary, name='media_summary'),
    path('reports/media-summary.xlsx', views.media_summary_xlsx, name='media_summary_xlsx'),
    path('followers/trend', views.followers_trend, name='followers_trend'),
    path('dashboard', views.dashboard_view, name='dashboard_view'),
    path('sync/all', views.sync_all, name='sync_all'),
    path('sync/cancel', views.sync_cancel, name='sync_cancel'),
    path('sync/facebook-usage', views.facebook_api_usage, name='facebook_api_usage'),
    path('sync/history', views.sync_history, name='sync_history'),
    path('posts', views.posts_list, name='posts_list'),
    path('social-bot/drafts', bot_views.bot_drafts_list, name='bot_drafts_list'),
    path('social-bot/create-task', bot_views.bot_create_task, name='bot_create_task'),
    path('social-bot/approve-draft', bot_views.bot_approve_draft, name='bot_approve_draft'),
    path('social-bot/publish-draft', bot_views.bot_publish_draft, name='bot_publish_draft'),
    path('social-bot/targets', bot_views.bot_targets_list_create, name='bot_targets_list_create'),
    path('social-bot/group-queue', bot_views.bot_group_queue, name='bot_group_queue'),
    path('social-bot/group-queue/<int:draft_id>/done', bot_views.bot_group_queue_done, name='bot_group_queue_done'),
]
