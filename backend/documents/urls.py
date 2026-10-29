from django.urls import path

from . import views

urlpatterns = [
    path("documents/weekly-reports", views.weekly_reports, name="weekly_reports"),
    path("documents/weekly-reports/generation-options", views.weekly_report_generation_options, name="weekly_report_generation_options"),
    path("documents/weekly-reports/generate-ai", views.weekly_reports_generate_ai, name="weekly_reports_generate_ai"),
    path("documents/weekly-reports/generate", views.weekly_reports_generate, name="weekly_reports_generate"),
    path("documents/weekly-reports/work-schedule-summary", views.weekly_report_work_schedule_summary, name="weekly_report_work_schedule_summary"),
    path("documents/weekly-reports/supplement", views.weekly_report_supplement, name="weekly_report_supplement"),
    path("documents/weekly-reports/supplement/upload", views.weekly_report_supplement_upload, name="weekly_report_supplement_upload"),
    path("documents/weekly-reports/supplement/attachment", views.weekly_report_supplement_delete_attachment, name="weekly_report_supplement_delete_attachment"),
    path("documents/weekly-reports/schedule", views.weekly_report_schedule, name="weekly_report_schedule"),
    path("documents/weekly-reports/sync", views.weekly_reports_sync, name="weekly_reports_sync"),
    path("documents/weekly-reports/webhook", views.weekly_report_document_webhook, name="weekly_report_document_webhook"),
    path("documents/weekly-reports/ai-status", views.weekly_report_ai_status, name="weekly_report_ai_status"),
    path("documents/weekly-reports/ai-jobs/<int:job_id>", views.weekly_report_ai_job_detail, name="weekly_report_ai_job_detail"),
    path("documents/weekly-reports/ai-jobs/<int:job_id>/cancel", views.weekly_report_ai_job_cancel, name="weekly_report_ai_job_cancel"),
    path("documents/weekly-reports/<int:report_id>/ai-rewrite", views.weekly_report_ai_rewrite, name="weekly_report_ai_rewrite"),
    path("documents/weekly-reports/<int:report_id>", views.weekly_report_update, name="weekly_report_update"),
    path("documents/weekly-reports/<int:report_id>.docx", views.weekly_report_docx, name="weekly_report_docx"),
    path("documents/numbers", views.document_number_register, name="document_number_register"),
    path("documents/numbers/issue", views.document_number_issue, name="document_number_issue"),
    path("documents/funding-proposal.docx", views.funding_proposal_docx, name="funding_proposal_docx"),
    path("documents/funding-proposal/drive", views.funding_proposal_save_to_drive, name="funding_proposal_save_to_drive"),
    path("documents/funding-proposal/status", views.funding_proposal_status, name="funding_proposal_status"),
]
