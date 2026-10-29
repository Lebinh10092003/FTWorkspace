"""URL patterns for news posts app."""

from django.urls import path
from . import views

urlpatterns = [
    path("", views.news_posts_list_create, name="news_posts_list_create"),
    path("parse-survey/", views.news_post_parse_survey, name="news_post_parse_survey"),
    path("parse-document/", views.news_post_parse_document, name="news_post_parse_document"),
    path("<int:pk>/", views.news_post_detail, name="news_post_detail"),
    path("<int:pk>/generate/", views.news_post_generate, name="news_post_generate"),
    path("<int:pk>/status/", views.news_post_status, name="news_post_status"),
    path("<int:pk>/cancel/", views.news_post_cancel, name="news_post_cancel"),
]
