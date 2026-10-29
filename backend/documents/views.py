from datetime import date, datetime, time, timedelta
import hmac
import logging
import os
import unicodedata
import uuid
from urllib.parse import quote

from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

# These are shared tools, like the QR and signature builders: any signed-in
# member can draft a document, so they are not scoped to a single module.
from authentication.permissions import IsWorkspaceAuthenticated
from work_schedule.models import WorkItem
from news_posts.document_parser import extract_text_from_file

from .funding_proposal import build_funding_proposal, file_title
from .funding_archive import save_proposal
from .funding_numbering import assign_funding_number
from .models import (
    AiReportJob,
    AiServiceHealth,
    FundingProposalRecord,
    WeeklyReport,
    WeeklyReportSchedule,
    WeeklyReportSupplement,
)
from .ai_service import cancel_ai_job, get_job_queue_position
from .numbering import (
    DOCUMENT_TYPES,
    format_number,
    issue_number,
    register_state,
    type_code_for,
)
from .weekly_report_docx import build_weekly_report_docx
from .weekly_reports import (
    build_schedule_reports,
    report_document_id,
    report_generation_options,
    report_sheet_id,
    resolve_report_week_start,
    run_weekly_report_pipeline,
    sync_reports_from_google_doc,
    week_start,
)

logger = logging.getLogger(__name__)


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
    if document_type.casefold() == "phiếu đề xuất kinh phí":
        return Response({"error": "Phiếu đề xuất kinh phí dùng dãy số riêng trong trình tạo phiếu."},
                        status=status.HTTP_400_BAD_REQUEST)
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
    """Number and download a proposal; downloading never writes to Drive."""
    payload = dict(request.data) if isinstance(request.data, dict) else {}
    try:
        payload["fileTitle"] = file_title(payload)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    record, error = _numbered_funding_proposal(request, payload)
    if error:
        return error
    filename, content = build_funding_proposal(payload)
    response = HttpResponse(
        content,
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    response["Content-Disposition"] = (
        f'attachment; filename="{_ascii_filename(filename)}"; '
        f"filename*=UTF-8''{quote(filename)}"
    )
    response["Content-Length"] = str(len(content))
    if record:
        response["X-Document-Number"] = record.document_number.split("/", 1)[0]
        response["X-Drive-File-URL"] = record.drive_url
    return response


def _numbered_funding_proposal(request, payload):
    draft_text = str(payload.get("draftId") or "").strip()
    if not draft_text:  # Compatibility with callers that render an unsigned form.
        return None, None
    try:
        draft_id = uuid.UUID(draft_text)
    except ValueError:
        return None, Response({"error": "Mã bản nháp không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    proposer = str(payload.get("proposer") or "").strip()
    project = str(payload.get("project") or payload.get("purpose") or "").strip()
    if not proposer or not project:
        return None, Response({"error": "Vui lòng nhập người đề xuất và công việc/dự án trước khi tạo phiếu."}, status=status.HTTP_400_BAD_REQUEST)
    owner_email = str(request.user.email or "").strip().lower()
    with transaction.atomic():
        record, _ = FundingProposalRecord.objects.get_or_create(
            draft_id=draft_id, defaults={"owner_email": owner_email},
        )
        record = FundingProposalRecord.objects.select_for_update().get(pk=record.pk)
        if record.owner_email != owner_email:
            return None, Response({"error": "Bản nháp này thuộc tài khoản khác."}, status=status.HTTP_403_FORBIDDEN)
        try:
            assign_funding_number(record)
        except ValueError as exc:
            return None, Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        record.file_title = str(payload.get("fileTitle") or "")
        record.proposer = proposer
        record.project = project
        record.purpose = str(payload.get("purpose") or "")
        record.payload = payload
        record.save(update_fields=["file_title", "proposer", "project", "purpose", "payload", "updated_at"])
    payload["documentNumber"] = record.document_number
    return record, None


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def funding_proposal_save_to_drive(request):
    """Save only when the user explicitly chooses the Drive action."""
    payload = dict(request.data) if isinstance(request.data, dict) else {}
    try:
        payload["fileTitle"] = file_title(payload)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    if not payload.get("draftId"):
        return Response({"error": "Thiếu mã bản nháp."}, status=status.HTTP_400_BAD_REQUEST)
    record, error = _numbered_funding_proposal(request, payload)
    if error:
        return error
    filename, content = build_funding_proposal(payload)
    try:
        file_id, drive_url = save_proposal(
            draft_id=record.draft_id, filename=filename, content=content,
            file_id=record.drive_file_id,
        )
    except Exception:
        logger.exception("Could not archive funding proposal draft %s", record.draft_id)
        return Response({"error": "Chưa lưu được phiếu vào Drive. Vui lòng thử lại; số phiếu sẽ được giữ nguyên."},
                        status=status.HTTP_502_BAD_GATEWAY)
    record.drive_file_id = file_id
    record.drive_url = drive_url
    record.save(update_fields=["drive_file_id", "drive_url", "updated_at"])
    return Response({"documentNumber": record.document_number, "driveUrl": drive_url, "fileName": filename})


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def funding_proposal_status(request):
    """Reconcile an old browser draft with its authoritative proposal number."""
    try:
        draft_id = uuid.UUID(str(request.query_params.get("draftId") or ""))
    except ValueError:
        return Response({"error": "Mã bản nháp không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)
    record = FundingProposalRecord.objects.filter(draft_id=draft_id).first()
    if not record:
        return Response({"documentNumber": "", "driveUrl": ""})
    if record.owner_email != str(request.user.email or "").strip().lower():
        return Response({"error": "Bản nháp này thuộc tài khoản khác."}, status=status.HTTP_403_FORBIDDEN)
    return Response({"documentNumber": record.document_number, "driveUrl": record.drive_url})


def _ascii_filename(filename):
    folded = unicodedata.normalize("NFKD", filename.replace("Đ", "D").replace("đ", "d"))
    plain = folded.encode("ascii", "ignore").decode("ascii").strip()
    return plain or "phieu-de-xuat-kinh-phi.docx"


def _weekly_report_payload(report):
    planned_items = report.planned_items or []
    planned_count = len(planned_items)
    planned_warning = (
        f"Tuần {report.planned_week} mới có {planned_count} việc, cần đăng ký thêm"
        if planned_count < 5
        else None
    )
    return {
        "id": report.pk,
        "employeeName": report.employee_name,
        "employeeEmail": report.employee_email,
        "completedWeek": report.completed_week,
        "plannedWeek": report.planned_week,
        "completedItems": report.completed_items,
        "difficulties": report.difficulties,
        "plannedItems": report.planned_items,
        "completedGroups": report.get_completed_groups(),
        "plannedGroups": report.get_planned_groups(),
        "includeBldTask": report.include_bld_task,
        "status": report.status,
        "statusDisplay": report.get_status_display(),
        "editedByName": report.edited_by_name,
        "editedByEmail": report.edited_by_email,
        "editedAt": report.edited_at.isoformat() if report.edited_at else None,
        "plannedWarning": planned_warning,
        "documentSyncedAt": report.document_synced_at.isoformat() if report.document_synced_at else None,
        "updatedAt": report.updated_at.isoformat(),
    }


def _user_role(request):
    role = getattr(request, "user_role", None) or getattr(getattr(request, "user", None), "role", None)
    return str(role or "EMPLOYEE").upper()


def _visible_weekly_reports(request):
    reports = WeeklyReport.objects.all()
    if _user_role(request) in {"ADMIN", "MANAGER"}:
        return reports
    email = str(getattr(request.user, "email", "") or "").strip().lower()
    return reports.filter(employee_email=email)


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
        "sources": {
            "sheetUrl": f"https://docs.google.com/spreadsheets/d/{quote(report_sheet_id(), safe='')}/edit",
            "documentUrl": f"https://docs.google.com/document/d/{quote(report_document_id(), safe='')}/edit",
        } if _user_role(request) == "ADMIN" else None,
    })


@api_view(["PUT", "PATCH"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_report_update(request, report_id):
    report = get_object_or_404(_visible_weekly_reports(request), pk=report_id)
    data = request.data if isinstance(request.data, dict) else {}

    completed_groups = data.get("completedGroups")
    if completed_groups is not None and isinstance(completed_groups, list):
        report.completed_groups = completed_groups
        report.completed_items = [
            str(item).strip()
            for g in completed_groups if isinstance(g, dict)
            for item in g.get("items", []) if str(item).strip()
        ]

    difficulties = data.get("difficulties")
    if difficulties is not None and isinstance(difficulties, list):
        report.difficulties = [str(item).strip() for item in difficulties if str(item).strip()]

    planned_groups = data.get("plannedGroups")
    if planned_groups is not None and isinstance(planned_groups, list):
        report.planned_groups = planned_groups
        report.planned_items = [
            str(item).strip()
            for g in planned_groups if isinstance(g, dict)
            for item in g.get("items", []) if str(item).strip()
        ]

    if "includeBldTask" in data:
        report.include_bld_task = bool(data.get("includeBldTask"))

    user_name = getattr(request.user, "name", "") or getattr(request.user, "email", "")
    report.status = WeeklyReport.STATUS_EDITED
    report.edited_by_name = str(user_name or "Người dùng").strip()
    report.edited_by_email = str(request.user.email or "").strip().lower()
    report.edited_at = timezone.now()
    report.save()

    return Response(_weekly_report_payload(report), status=status.HTTP_200_OK)


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


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_report_ai_rewrite(request, report_id):
    """Enqueue an AI rewrite job for the user's weekly report."""
    report = get_object_or_404(WeeklyReport, pk=report_id)

    # Permission check: strictly report owner only
    user_email = str(getattr(request.user, "email", "") or "").strip().lower()
    report_email = str(report.employee_email or "").strip().lower()
    if not user_email or user_email != report_email:
        return Response(
            {"error": "Bạn chỉ có thể yêu cầu AI viết lại cho báo cáo của chính mình."},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Health check
    health = AiServiceHealth.get_current()
    if health.status == AiServiceHealth.STATUS_AUTH_ERROR:
        return Response(
            {"error": "AI tạm ngừng, quản trị viên cần đăng nhập lại."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    # One job per user limit (queued or running)
    active_job = AiReportJob.objects.filter(
        user=request.user,
        status__in=[AiReportJob.STATUS_QUEUED, AiReportJob.STATUS_RUNNING],
    ).first()
    if active_job:
        return Response(
            {
                "error": "Bạn đã có một yêu cầu đang chờ hoặc đang xử lý. Vui lòng đợi hoặc hủy yêu cầu trước đó.",
                "activeJobId": active_job.id,
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    job = AiReportJob.objects.create(
        user=request.user,
        report=report,
        status=AiReportJob.STATUS_QUEUED,
    )

    return Response({
        "jobId": job.id,
        "status": job.status,
        "queuePosition": get_job_queue_position(job),
        "createdAt": job.created_at.isoformat(),
    }, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_report_ai_job_detail(request, job_id):
    """Check status and retrieve results of an AI rewrite job."""
    job = get_object_or_404(AiReportJob.objects.select_related("user"), pk=job_id)

    user_email = str(getattr(request.user, "email", "") or "").strip().lower()
    job_email = str(job.user.email or "").strip().lower()
    if user_email != job_email and _user_role(request) not in {"ADMIN", "MANAGER"}:
        return Response({"error": "Bạn không có quyền xem yêu cầu này."}, status=status.HTTP_403_FORBIDDEN)

    return Response({
        "id": job.id,
        "reportId": job.report_id,
        "status": job.status,
        "queuePosition": get_job_queue_position(job),
        "result": job.result if job.status == AiReportJob.STATUS_DONE else None,
        "errorMessage": job.error_message if job.status == AiReportJob.STATUS_FAILED else "",
        "durationSeconds": job.duration_seconds,
        "createdAt": job.created_at.isoformat(),
        "startedAt": job.started_at.isoformat() if job.started_at else None,
        "completedAt": job.completed_at.isoformat() if job.completed_at else None,
    })


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_report_ai_job_cancel(request, job_id):
    """Cancel a queued or running AI rewrite job."""
    job = get_object_or_404(AiReportJob.objects.select_related("user"), pk=job_id)

    try:
        cancelled = cancel_ai_job(job, user=request.user)
    except PermissionError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_403_FORBIDDEN)

    return Response({
        "id": job.id,
        "status": job.status,
        "cancelled": cancelled,
        "message": "Đã hủy yêu cầu AI thành công." if cancelled else "Yêu cầu đã kết thúc hoặc không thể hủy.",
    })


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_report_ai_status(request):
    """Return health and status of the AI report rewrite service."""
    health = AiServiceHealth.get_current()
    return Response({
        "status": health.status,
        "ready": health.is_ready(),
        "statusDisplay": health.get_status_display(),
        "errorMessage": health.error_message,
        "sessionDays": health.session_days_alive(),
        "lastCheckedAt": health.last_checked_at.isoformat() if health.last_checked_at else None,
        "lastReadyAt": health.last_ready_at.isoformat() if health.last_ready_at else None,
    })


def _resolve_supplement_week_start(value: Any, today: Optional[date] = None) -> date:
    """Parse Monday date for a reporting week."""
    today = today or timezone.localdate()
    if not value:
        # Default reporting week: if Thu or earlier, previous week; if Fri or later, current week
        current_monday = week_start(today)
        return current_monday - timedelta(days=7) if today.weekday() <= 3 else current_monday
    try:
        parsed = date.fromisoformat(str(value).strip())
    except ValueError as exc:
        raise ValueError("Ngày đầu tuần không hợp lệ (định dạng YYYY-MM-DD).") from exc
    return week_start(parsed)


@api_view(["GET", "PUT"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_report_supplement(request):
    """Get or update notes for the current user's reporting week."""
    try:
        raw_val = request.query_params.get("weekStart") if request.method == "GET" else request.data.get("weekStart")
        target_week = _resolve_supplement_week_start(raw_val)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    supp = WeeklyReportSupplement.objects.filter(user=request.user, week_start=target_week).first()

    if request.method == "PUT":
        data = request.data if isinstance(request.data, dict) else {}
        note = str(data.get("note", "") or "")
        if len(note) > 50_000:
            return Response({"error": "Ghi chú quá dài (tối đa 50.000 ký tự)."}, status=status.HTTP_400_BAD_REQUEST)
        if not supp:
            supp = WeeklyReportSupplement.objects.create(
                user=request.user,
                week_start=target_week,
                note=note,
                attachments=[],
            )
        else:
            supp.note = note
            supp.save(update_fields=["note", "updated_at"])

    return Response({
        "weekStart": target_week.isoformat(),
        "note": supp.note if supp else "",
        "attachments": supp.attachments if supp else [],
        "totalChars": supp.total_text_chars() if supp else 0,
        "updatedAt": supp.updated_at.isoformat() if supp else None,
    })


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_report_supplement_upload(request):
    """Upload and immediately extract text from a document (.docx, .txt, .md, .csv). Never store raw file."""
    upload_file = request.FILES.get("file")
    if not upload_file:
        return Response({"error": "Vui lòng chọn tệp tin cần tải lên."}, status=status.HTTP_400_BAD_REQUEST)

    if upload_file.size > 5 * 1024 * 1024:
        return Response({"error": "Kích thước tệp vượt quá giới hạn 5MB."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        target_week = _resolve_supplement_week_start(request.data.get("weekStart"))
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    file_bytes = upload_file.read()
    try:
        parsed_doc = extract_text_from_file(file_bytes, upload_file.name)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    supp, _ = WeeklyReportSupplement.objects.get_or_create(
        user=request.user,
        week_start=target_week,
        defaults={"attachments": [], "note": ""},
    )

    current_attachments = list(supp.attachments or [])
    if len(current_attachments) >= 5:
        return Response({"error": "Mỗi tuần chỉ được đính kèm tối đa 5 tệp tin."}, status=status.HTTP_400_BAD_REQUEST)

    current_chars = supp.total_text_chars()
    new_chars = len(parsed_doc.get("text", ""))
    if current_chars + new_chars > 60_000:
        return Response({
            "error": f"Tổng dung lượng văn bản của các tệp đính kèm vượt quá 60.000 ký tự (hiện có: {current_chars}, thêm mới: {new_chars}).",
        }, status=status.HTTP_400_BAD_REQUEST)

    # Disambiguate duplicate file names
    base_name = parsed_doc["name"]
    fname = base_name
    counter = 1
    existing_names = {att.get("name") for att in current_attachments if isinstance(att, dict)}
    while fname in existing_names:
        name_part, dot, ext = base_name.rpartition(".")
        fname = f"{name_part} ({counter}).{ext}" if dot else f"{base_name} ({counter})"
        counter += 1

    current_attachments.append({
        "name": fname,
        "size": parsed_doc["size"],
        "text": parsed_doc["text"],
        "charCount": parsed_doc.get("charCount", len(parsed_doc["text"])),
        "truncated": parsed_doc.get("truncated", False),
        "uploadedAt": timezone.now().isoformat(),
    })

    supp.attachments = current_attachments
    supp.save(update_fields=["attachments", "updated_at"])

    return Response({
        "weekStart": target_week.isoformat(),
        "attachments": supp.attachments,
        "totalChars": supp.total_text_chars(),
        "note": supp.note,
        "message": f"Đã tải lên và trích xuất thành công tệp '{fname}'.",
    }, status=status.HTTP_201_CREATED)


@api_view(["POST", "DELETE"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_report_supplement_delete_attachment(request):
    """Remove one attachment by filename or index from this week's supplement."""
    try:
        raw_val = request.query_params.get("weekStart") if request.method == "DELETE" else request.data.get("weekStart")
        target_week = _resolve_supplement_week_start(raw_val)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    supp = WeeklyReportSupplement.objects.filter(user=request.user, week_start=target_week).first()
    if not supp or not supp.attachments:
        return Response({"error": "Không tìm thấy tệp đính kèm để xóa."}, status=status.HTTP_404_NOT_FOUND)

    payload = request.data if isinstance(request.data, dict) else {}
    target_name = str(request.query_params.get("filename") or payload.get("filename") or "").strip()
    target_idx = request.query_params.get("index") or payload.get("index")

    current_attachments = list(supp.attachments or [])
    new_attachments = []
    removed = False

    if target_idx is not None:
        try:
            idx_int = int(target_idx)
            if 0 <= idx_int < len(current_attachments):
                new_attachments = [att for i, att in enumerate(current_attachments) if i != idx_int]
                removed = True
        except ValueError:
            pass

    if not removed and target_name:
        for att in current_attachments:
            if isinstance(att, dict) and att.get("name") == target_name and not removed:
                removed = True
                continue
            new_attachments.append(att)

    if not removed:
        return Response({"error": "Không tìm thấy tệp đính kèm cần xóa."}, status=status.HTTP_404_NOT_FOUND)

    supp.attachments = new_attachments
    supp.save(update_fields=["attachments", "updated_at"])

    return Response({
        "weekStart": target_week.isoformat(),
        "attachments": supp.attachments,
        "totalChars": supp.total_text_chars(),
        "note": supp.note,
        "message": "Đã xóa tệp đính kèm.",
    })


@api_view(["GET", "PUT"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_report_schedule(request):
    """Retrieve or update weekly auto-run schedule preferences for the current user."""
    sched, _ = WeeklyReportSchedule.objects.get_or_create(user=request.user)

    if request.method == "PUT":
        data = request.data if isinstance(request.data, dict) else {}
        if "enabled" in data:
            sched.enabled = bool(data.get("enabled"))
        if "weekday" in data:
            try:
                wday = int(data.get("weekday"))
                if not (0 <= wday <= 6):
                    raise ValueError
                sched.weekday = wday
            except (ValueError, TypeError):
                return Response({"error": "Thứ trong tuần không hợp lệ (0 = Thứ Hai ... 6 = Chủ Nhật)."}, status=status.HTTP_400_BAD_REQUEST)
        if "runTime" in data:
            rt_str = str(data.get("runTime") or "").strip()
            try:
                parsed_time = datetime.strptime(rt_str, "%H:%M").time()
                sched.run_time = parsed_time
            except ValueError:
                return Response({"error": "Giờ chạy không hợp lệ (định dạng HH:MM, ví dụ 16:00)."}, status=status.HTTP_400_BAD_REQUEST)
        if "remindMinutes" in data:
            try:
                rm = int(data.get("remindMinutes"))
                if rm < 0 or rm > 1440:
                    raise ValueError
                sched.remind_minutes = rm
            except (ValueError, TypeError):
                return Response({"error": "Số phút nhắc trước không hợp lệ (0 - 1440 phút)."}, status=status.HTTP_400_BAD_REQUEST)

        sched.save()

    return Response({
        "enabled": sched.enabled,
        "weekday": sched.weekday,
        "runTime": sched.run_time.strftime("%H:%M") if hasattr(sched.run_time, "strftime") else str(sched.run_time)[:5],
        "remindMinutes": sched.remind_minutes,
        "lastRemindedWeek": sched.last_reminded_week,
        "lastRunWeek": sched.last_run_week,
        "updatedAt": sched.updated_at.isoformat(),
    })


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_report_work_schedule_summary(request):
    """Return task counts for the selected reporting week and the upcoming planned week."""
    try:
        raw_val = request.query_params.get("weekStart")
        selected_start = _resolve_supplement_week_start(raw_val)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    next_start = selected_start + timedelta(days=7)
    next_end = next_start + timedelta(days=7)
    completed_week = selected_start.isocalendar().week
    planned_week = next_start.isocalendar().week

    user_email = str(getattr(request.user, "email", "") or "").strip().lower()
    c_count = WorkItem.objects.filter(
        executor__email=user_email,
        work_date__gte=selected_start,
        work_date__lt=next_start,
    ).count()

    p_count = WorkItem.objects.filter(
        executor__email=user_email,
        work_date__gte=next_start,
        work_date__lt=next_end,
    ).count()

    planned_warning = None
    if p_count < 5:
        planned_warning = f"Tuần {planned_week} mới có {p_count} việc, cần đăng ký thêm"

    return Response({
        "weekStart": selected_start.isoformat(),
        "completedWeek": completed_week,
        "plannedWeek": planned_week,
        "completedCount": c_count,
        "plannedCount": p_count,
        "plannedWarning": planned_warning,
    })


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def weekly_reports_generate_ai(request):
    """Create or stage a report draft from work schedule and immediately enqueue AI generation with supplement."""
    user_email = str(getattr(request.user, "email", "") or "").strip().lower()
    if not user_email:
        return Response({"error": "Vui lòng đăng nhập để tạo báo cáo tuần."}, status=status.HTTP_403_FORBIDDEN)

    # Health check
    health = AiServiceHealth.get_current()
    if health.status == AiServiceHealth.STATUS_AUTH_ERROR:
        return Response(
            {"error": "AI tạm ngừng, quản trị viên cần đăng nhập lại."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    # Concurrency limit check
    active_job = AiReportJob.objects.filter(
        user=request.user,
        status__in=[AiReportJob.STATUS_QUEUED, AiReportJob.STATUS_RUNNING],
    ).first()
    if active_job:
        return Response(
            {
                "error": "Bạn đã có một yêu cầu đang chờ hoặc đang xử lý. Vui lòng đợi hoặc hủy yêu cầu trước đó.",
                "activeJobId": active_job.id,
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    payload = request.data if isinstance(request.data, dict) else {}
    try:
        selected_start = resolve_report_week_start(payload.get("weekStart"))
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    # 1. Stage or refresh the user's WeeklyReport snapshot from work schedule
    try:
        reports = build_schedule_reports(
            report_week_start=selected_start,
            employee_email=user_email,
        )
        if not reports:
            return Response({"error": "Không thể khởi tạo bản báo cáo tuần cho nhân viên."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        report = reports[0]
    except Exception as exc:
        logger.exception("Error building schedule report draft: %s", exc)
        return Response({"error": f"Lỗi khởi tạo bản nháp từ lịch công tác: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)

    # 2. Capture supplement snapshot
    supp = WeeklyReportSupplement.objects.filter(user=request.user, week_start=selected_start).first()
    snapshot = {}
    if supp:
        snapshot = {
            "note": supp.note,
            "attachments": supp.attachments or [],
        }

    # 3. Create AI Job carrying the supplement snapshot
    job = AiReportJob.objects.create(
        user=request.user,
        report=report,
        supplement_snapshot=snapshot,
        status=AiReportJob.STATUS_QUEUED,
    )

    return Response({
        "jobId": job.id,
        "reportId": report.id,
        "status": job.status,
        "queuePosition": get_job_queue_position(job),
        "createdAt": job.created_at.isoformat(),
        "completedWeek": report.completed_week,
        "plannedWeek": report.planned_week,
    }, status=status.HTTP_201_CREATED)

