from django.urls import path

from . import views

urlpatterns = [
    path("company-accounts", views.company_accounts, name="company_accounts"),
    path("company-accounts/summary", views.company_accounts_summary, name="company_accounts_summary"),
    path("company-accounts/logs", views.company_account_logs, name="company_account_logs"),
    path("company-accounts/<int:pk>", views.company_account_detail, name="company_account_detail"),
    path("company-accounts/<int:pk>/reveal", views.company_account_reveal, name="company_account_reveal"),
]
