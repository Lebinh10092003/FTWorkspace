import hmac
import os
import unicodedata
from urllib.parse import quote

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

# These are shared tools, like the QR and signature builders: any signed-in
# member can draft a document, so they are not scoped to a single module.
from authentication.permissions import IsWorkspaceAuthenticated

from .funding_proposal import build_funding_proposal
from .models import WeeklyReport
from .numbering import (
    DOCUMENT_TYPES,
    format_number,
    issue_number,
    register_state,
    type_code_for,
)
from .weekly_report_docx import build_weekly_report_docx
from .weekly_reports import (
    report_generation_options,
    resolve_report_week_start,
    run_weekly_report_pipeline,
    sync_reports_from_google_doc,
)


def _google_token(request):
    return str(request.data.get("googleAccessToken") or request.query_params.get("googleAccessToken") or "").strip() or None


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def document_number_register(request):
    """Next available number plus the tail of the register, read from the Sheet."""
    try:
        state = register_state(google_token=_google_token(request))
    except ValueError as error:
        return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)
    document_type = str(request.query_params.get("documentType") or "Công văn")
    state["documentTypes"] = DOCUMENT_TYPES
    state["preview"] = format_number(state["next"], document_type)
    state["typeCode"] = type_code_for(document_type)
    return Response(state)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def document_number_issue(request):
    """Take the next number and write the row into the register."""
    document_type = str(request.data.get("documentType") or "").strip()
    subject = str(request.data.get("subject") or "").strip()
    if not document_type:
        return Response({"error": "Vui lòng chọn loại văn bản."}, status=status.HTTP_400_BAD_REQUEST)
    if not subject:
        return Response({"error": "Vui lòng nhập nội dung công việc."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        issued = issue_number(
            document_type=document_type,
            subject=subject,
            drafter=request.data.get("drafter"),
            signer=request.data.get("signer"),
            issued_on=request.data.get("issuedOn"),
            google_token=_google_token(request),
        )
    except ValueError as error:
        return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(issued, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def funding_proposal_docx(request):
    """Render the funding proposal and return it as a Word download."""
    payload = request.data if isinstance(request.data, dict) else {}
    filename, content = build_funding_proposal(payload)
    response = HttpResponse(
        content,
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    # The name carries Vietnamese characters. Left whole, Django RFC2047-encodes
    # the entire header and browsers save it under a mangled name, so send an
    # ASCII fallback beside the UTF-8 form (RFC 6266).
    response["Content-Disposition"] = (
        f'attachment; filename="{_ascii_filename(filename)}"; '
        f"filename*=UTF-8''{quote(filename)}"
    )
    response["Content-Length"] = str(len(content))
    return response


def _ascii_filename(filename):
    folded = unicodedata.normalize("NFKD", filename.replace("Đ", "D").replace("đ", "d"))
    plain = folded.encode("ascii", "ignore").decode("ascii").strip()
    return plain or "phieu-de-xuat-kinh-phi.docx"


def _weekly_report_payload(report):
    return {
        "id": report.pk,
        "employeeName": report.employee_name,
        "employeeEmail": report.employee_email,
        "completedWeek": report.completed_week,
        "plannedWeek": report.planned_week,
        "completedItems": report.completed_items,
        "difficulties": report.difficulties,
        "plannedItems": report.planned_items,
        "status": report.status,
        "documentSyncedAt": report.document_synced_at.isoformat() if report.document_synced_at else None,
        "updatedAt": report.updated_at.isoformat(),
    }


def _visible_weekly_reports(request):
    reports = WeeklyReport.objects.all()
    if getattr(request, "user_role", "") in {"ADMIN", "MANAGER"}:
        return reports
    return reports.filter(employee_email=str(request.user.email or "").strip().lower())


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_reports(request):
    """Return staged report packets already created by the web or timer."""
    reports = _visible_weekly_reports(request)
    week = str(request.query_params.get("week") or "").strip()
    if week.isdigit():
        reports = reports.filter(completed_week=int(week))
    return Response({
        "reports": [_weekly_report_payload(report) for report in reports[:100]],
    })


def _can_generate_weekly_report(request):
    return bool(str(getattr(request.user, "email", "") or "").strip())


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_report_generation_options(request):
    if not _can_generate_weekly_report(request):
        return Response({"error": "Vui lòng đăng nhập để tạo gói báo cáo tuần."}, status=status.HTTP_403_FORBIDDEN)
    return Response({"options": report_generation_options()})


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_reports_generate(request):
    """Synchronise and stage one selected reporting week for its requester."""
    if not _can_generate_weekly_report(request):
        return Response({"error": "Vui lòng đăng nhập để tạo gói báo cáo tuần."}, status=status.HTTP_403_FORBIDDEN)
    payload = request.data if isinstance(request.data, dict) else {}
    try:
        selected_start = resolve_report_week_start(payload.get("weekStart"))
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    try:
        result = run_weekly_report_pipeline(
            report_week_start=selected_start,
            employee_email=str(request.user.email).strip().lower(),
        )
    except Exception as exc:
        return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
    return Response(result, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_reports_sync(request):
    if str(getattr(request, "user_role", "") or "").upper() not in {"ADMIN", "MANAGER"}:
        return Response({"error": "Chỉ quản lý hoặc quản trị viên có thể yêu cầu đồng bộ ngay."}, status=status.HTTP_403_FORBIDDEN)
    try:
        return Response(sync_reports_from_google_doc())
    except Exception as exc:
        return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def weekly_report_document_webhook(request):
    """Callback for the external AI after it has written the Google Doc.

    The AI service does not need a Workspace login; it only receives a separate
    server-side secret and cannot create or edit reports itself.  It merely
    asks the server to read the shared Doc and issue normal Workspace alerts.
    """
    expected_secret = os.getenv("WEEKLY_REPORT_WEBHOOK_SECRET", "")
    provided_secret = request.headers.get("X-Weekly-Report-Webhook-Secret", "")
    if not expected_secret or not hmac.compare_digest(provided_secret, expected_secret):
        return Response({"error": "Không xác thực được webhook."}, status=status.HTTP_401_UNAUTHORIZED)
    try:
        return Response(sync_reports_from_google_doc())
    except Exception as exc:
        return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_report_docx(request, report_id):
    report = get_object_or_404(_visible_weekly_reports(request), pk=report_id)
    filename, content = build_weekly_report_docx(report)
    response = HttpResponse(
        content,
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    response["Content-Disposition"] = (
        f'attachment; filename="{_ascii_filename(filename)}"; '
        f"filename*=UTF-8''{quote(filename)}"
    )
    response["Content-Length"] = str(len(content))
    return response
