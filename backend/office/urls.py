from django.urls import path
from . import views

urlpatterns = [
    path('heartbeat/', views.HeartbeatView.as_view(), name='office-heartbeat'),
    path('roster/', views.OfficeRosterView.as_view(), name='office-roster'),
    path('me/avatar/', views.MyAvatarView.as_view(), name='office-me-avatar'),
    path('seats/', views.AdminSeatsView.as_view(), name='office-seats'),
]
