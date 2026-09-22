from django.urls import path

from . import views

urlpatterns = [
    path("documents/weekly-reports", views.weekly_reports, name="weekly_reports"),
    path("documents/weekly-reports/generation-options", views.weekly_report_generation_options, name="weekly_report_generation_options"),
    path("documents/weekly-reports/generate", views.weekly_reports_generate, name="weekly_reports_generate"),
    path("documents/weekly-reports/sync", views.weekly_reports_sync, name="weekly_reports_sync"),
    path("documents/weekly-reports/webhook", views.weekly_report_document_webhook, name="weekly_report_document_webhook"),
    path("documents/weekly-reports/<int:report_id>.docx", views.weekly_report_docx, name="weekly_report_docx"),
    path("documents/numbers", views.document_number_register, name="document_number_register"),
    path("documents/numbers/issue", views.document_number_issue, name="document_number_issue"),
    path("documents/funding-proposal.docx", views.funding_proposal_docx, name="funding_proposal_docx"),
]
