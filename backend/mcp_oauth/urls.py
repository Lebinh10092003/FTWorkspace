from django.urls import path, re_path

from . import views

# Gắn ở gốc (config/urls.py): /.well-known/* và /api/oauth/*
urlpatterns = [
    re_path(r"^\.well-known/oauth-protected-resource(?P<suffix>/.*)?$", views.protected_resource_metadata,
            name="oauth_protected_resource"),
    re_path(r"^\.well-known/oauth-authorization-server(?P<suffix>/.*)?$", views.authorization_server_metadata,
            name="oauth_authorization_server"),
    re_path(r"^\.well-known/openid-configuration(?P<suffix>/.*)?$", views.authorization_server_metadata,
            name="oauth_openid_configuration"),
    path("api/oauth/register", views.register, name="oauth_register"),
    path("api/oauth/authorize", views.authorize, name="oauth_authorize"),
    path("api/oauth/token", views.token, name="oauth_token"),
    path("api/oauth/revoke", views.revoke, name="oauth_revoke"),
]
