from django.urls import path

from . import views

urlpatterns = [
    path("documents/numbers", views.document_number_register, name="document_number_register"),
    path("documents/numbers/issue", views.document_number_issue, name="document_number_issue"),
    path("documents/funding-proposal.docx", views.funding_proposal_docx, name="funding_proposal_docx"),
]
